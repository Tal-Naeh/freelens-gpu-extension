/**
 * Turns parsed exporter metrics into PodGPU rows. Straight port of
 * kubectl-gpugo's internal/scraper (extractSamples, aggregateByPod,
 * aggregateByGPU, buildEnricherRows) so both tools agree on attribution.
 *
 * Three attribution paths, chosen in this order:
 *   1. per-process exporter (gpu_process_memory_bytes with pod labels)
 *   2. dcgm-exporter with pod labels (--kubernetes=true, the GPU Operator default)
 *   3. dcgm-exporter without pod labels -> per-(node, GPU) rows + candidate pods
 */

import type { Families, Sample } from "./prom";
import type { GpuDevice, PodGPU } from "./types";

export interface FlatSample {
  ns: string;
  pod: string;
  gpu: string;
  node: string;
  name: string;
  val: number;
}

const WANTED_DCGM = [
  "DCGM_FI_DEV_GPU_UTIL",
  "DCGM_FI_DEV_FB_USED",
  "DCGM_FI_DEV_FB_FREE",
  "DCGM_FI_DEV_POWER_USAGE",
  // per-MIG-slice graphics engine activity ratio [0,1]; MIG installs disable
  // DCGM_FI_DEV_GPU_UTIL entirely, so this stands in as util on MIG.
  "DCGM_FI_PROF_GR_ENGINE_ACTIVE",
];

const DEVICE_DCGM = [...WANTED_DCGM, "DCGM_FI_DEV_GPU_TEMP", "DCGM_FI_DEV_FB_TOTAL"];

/** DCGM: flatten wanted families into (ns, pod, gpu, node, metric, value). */
export function extractDcgmSamples(fams: Families, exporterNode: string): FlatSample[] {
  const out: FlatSample[] = [];
  for (const name of WANTED_DCGM) {
    for (const m of fams.get(name) ?? []) {
      const l = m.labels;
      const ns = l.namespace || l.exported_namespace || "";
      const pod = l.pod || l.exported_pod || "";
      let gpu = l.gpu || l.device || l.UUID || "";
      // MIG: `gpu` is the physical card, GPU_I_ID the slice. Key on both or
      // several pods sharing card 0 collapse into one row.
      if (l.GPU_I_ID) gpu = `${gpu}:${l.GPU_I_ID}`;
      const node = l.Hostname || exporterNode;
      out.push({ ns, pod, gpu, node, name, val: m.value });
    }
  }
  return out;
}

interface Acc {
  row: PodGPU;
  seenGPU: Set<string>;
  utilSum: number;
}

function apply(acc: Acc, metric: string, gpu: string, v: number) {
  // Count the (pod, gpu) pair regardless of which metric brought us here:
  // MIG installs never emit DCGM_FI_DEV_GPU_UTIL.
  if (!acc.seenGPU.has(gpu)) {
    acc.seenGPU.add(gpu);
    acc.row.gpuCount++;
    if (gpu !== "") acc.row.gpus.push(gpu);
  }
  switch (metric) {
    case "DCGM_FI_DEV_GPU_UTIL":
      acc.utilSum += v;
      break;
    case "DCGM_FI_PROF_GR_ENGINE_ACTIVE":
      acc.utilSum += v * 100; // ratio -> percent, to match GPU_UTIL semantics
      break;
    case "DCGM_FI_DEV_FB_USED":
      acc.row.vramUsedMiB += v;
      break;
    case "DCGM_FI_DEV_FB_FREE":
      acc.row.vramFreeMiB += v;
      break;
    case "DCGM_FI_DEV_POWER_USAGE":
      acc.row.powerWatts += v;
      break;
  }
}

function finalize(accs: Map<string, Acc>): PodGPU[] {
  const out: PodGPU[] = [];
  for (const acc of accs.values()) {
    if (acc.row.gpuCount > 0) acc.row.gpuUtilPct = acc.utilSum / acc.row.gpuCount;
    acc.row.gpus.sort();
    out.push(acc.row);
  }
  return out;
}

function newRow(partial: Partial<PodGPU> & Pick<PodGPU, "namespace" | "pod" | "node">): PodGPU {
  return {
    gpus: [],
    gpuCount: 0,
    gpuUtilPct: 0,
    vramUsedMiB: 0,
    vramFreeMiB: 0,
    powerWatts: 0,
    ...partial,
  };
}

/** DCGM path 2: one row per workload pod (samples without pod labels are dropped). */
export function aggregateByPod(samples: FlatSample[]): PodGPU[] {
  const accs = new Map<string, Acc>();
  for (const s of samples) {
    if (!s.ns || !s.pod) continue;
    const key = `${s.ns}/${s.pod}`;
    let acc = accs.get(key);
    if (!acc) {
      acc = { row: newRow({ namespace: s.ns, pod: s.pod, node: s.node }), seenGPU: new Set(), utilSum: 0 };
      accs.set(key, acc);
    } else if (!acc.row.node) {
      acc.row.node = s.node;
    }
    apply(acc, s.name, s.gpu, s.val);
  }
  return finalize(accs);
}

/** DCGM path 3: one row per (node, GPU). Caller attaches hintPods. */
export function aggregateByGPU(samples: FlatSample[]): PodGPU[] {
  const accs = new Map<string, Acc>();
  for (const s of samples) {
    const gpu = s.gpu || "?";
    const key = `${s.node}/${gpu}`;
    let acc = accs.get(key);
    if (!acc) {
      acc = {
        row: newRow({ namespace: "-", pod: `(gpu ${gpu})`, node: s.node, gpuIndex: gpu, gpus: [gpu], gpuCount: 1 }),
        seenGPU: new Set([gpu]),
        utilSum: 0,
      };
      accs.set(key, acc);
    }
    apply(acc, s.name, gpu, s.val);
  }
  return finalize(accs);
}

export interface EnricherResult {
  fams: Families;
  node: string;
}

const MIB = 1024 * 1024;

/**
 * Path 1: per-process exporter. Sums process VRAM per (pod, GPU uuid), takes
 * max util across a pod's processes, and splits each GPU's total power across
 * its pods proportionally to VRAM share.
 */
export function buildEnricherRows(results: EnricherResult[]): PodGPU[] {
  interface GpuInfo {
    totalVRAM: number;
    powerW: number;
  }
  interface Use {
    node: string;
    gpuIdx: string;
    vramBytes: number;
    utilPct: number;
  }
  const gpus = new Map<string, GpuInfo>(); // uuid
  const pods = new Map<string, Map<string, Use>>(); // ns/pod -> uuid -> use

  const useFor = (m: Sample, node: string): Use | undefined => {
    const { namespace: ns, pod, uuid, gpu = "" } = m.labels;
    if (!ns || !pod || !uuid) return undefined;
    const key = `${ns}/${pod}`;
    let byUuid = pods.get(key);
    if (!byUuid) {
      byUuid = new Map();
      pods.set(key, byUuid);
    }
    let use = byUuid.get(uuid);
    if (!use) {
      use = { node, gpuIdx: gpu, vramBytes: 0, utilPct: 0 };
      byUuid.set(uuid, use);
    } else if (!use.gpuIdx) {
      use.gpuIdx = gpu;
    }
    return use;
  };
  const gpuFor = (m: Sample): GpuInfo | undefined => {
    const { uuid } = m.labels;
    if (!uuid) return undefined;
    let g = gpus.get(uuid);
    if (!g) {
      g = { totalVRAM: 0, powerW: 0 };
      gpus.set(uuid, g);
    }
    return g;
  };

  for (const r of results) {
    for (const m of r.fams.get("gpu_process_memory_bytes") ?? []) {
      const u = useFor(m, r.node);
      if (u) u.vramBytes += m.value;
    }
    for (const m of r.fams.get("gpu_process_utilization_percent") ?? []) {
      const u = useFor(m, r.node);
      if (u && m.value > u.utilPct) u.utilPct = m.value;
    }
    for (const m of r.fams.get("gpu_total_memory_bytes") ?? []) {
      const g = gpuFor(m);
      if (g) g.totalVRAM = m.value;
    }
    for (const m of r.fams.get("gpu_power_usage_watts") ?? []) {
      const g = gpuFor(m);
      if (g) g.powerW = m.value;
    }
  }

  const rows: PodGPU[] = [];
  for (const [nsPod, uses] of pods) {
    const i = nsPod.indexOf("/");
    const ns = nsPod.slice(0, i);
    const pod = nsPod.slice(i + 1);
    let totalUsed = 0;
    let totalGPU = 0;
    let power = 0;
    let maxUtil = 0;
    let node = "";
    const gpuIdxs: string[] = [];
    for (const [uuid, use] of uses) {
      totalUsed += use.vramBytes;
      maxUtil = Math.max(maxUtil, use.utilPct);
      if (!node) node = use.node;
      if (use.gpuIdx) gpuIdxs.push(use.gpuIdx);
      const g = gpus.get(uuid);
      if (g) {
        totalGPU += g.totalVRAM;
        if (g.totalVRAM > 0) power += g.powerW * (use.vramBytes / g.totalVRAM);
      }
    }
    gpuIdxs.sort();
    rows.push({
      namespace: ns,
      pod,
      node,
      gpus: gpuIdxs,
      gpuCount: uses.size,
      gpuUtilPct: maxUtil,
      vramUsedMiB: totalUsed / MIB,
      vramFreeMiB: (totalGPU - totalUsed) / MIB,
      powerWatts: power,
    });
  }
  return rows;
}

/**
 * Sort key: zero-padded GPU index components so "0:8" < "0:10" and rows on
 * the same card / slice cluster together. Same rule as kubectl-gpugo.
 */
export function gpuSortKey(r: PodGPU): string {
  if (r.gpus.length === 0) return "~";
  return r.gpus
    .map((g) =>
      g
        .split(":")
        .map((p) => p.padStart(3, "0"))
        .join(":"),
    )
    .join(",");
}

/** Display order: by GPU, then VRAM used desc, then namespace/pod. */
export function sortRows(rows: PodGPU[]): PodGPU[] {
  return [...rows].sort((a, b) => {
    const ka = gpuSortKey(a);
    const kb = gpuSortKey(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    if (a.vramUsedMiB !== b.vramUsedMiB) return b.vramUsedMiB - a.vramUsedMiB;
    if (a.namespace !== b.namespace) return a.namespace < b.namespace ? -1 : 1;
    return a.pod < b.pod ? -1 : a.pod > b.pod ? 1 : 0;
  });
}

/** Physical card grouping for visual separators: "0:8" -> "0". */
export function physicalGPUGroup(r: PodGPU): string {
  if (r.gpus.length === 0) return "";
  const first = r.gpus[0];
  const i = first.indexOf(":");
  return i >= 0 ? first.slice(0, i) : r.gpus.join(",");
}

// ---------------------------------------------------------------------------
// Per-device view (one row per physical GPU / MIG slice)
// ---------------------------------------------------------------------------

interface DevAcc {
  dev: GpuDevice;
  utilSum: number;
  utilN: number;
  fbTotal?: number;
  pods: Set<string>;
}

function devKey(node: string, gpu: string) {
  return `${node}/${gpu}`;
}

function newDev(node: string, gpu: string): DevAcc {
  return {
    dev: { node, gpu, utilPct: 0, vramUsedMiB: 0, vramTotalMiB: 0, powerWatts: 0, pods: [] },
    utilSum: 0,
    utilN: 0,
    pods: new Set(),
  };
}

/**
 * DCGM: every metric line is already per device (per slice on MIG), and the
 * same device appears once per attributed pod when several pods share it.
 * Take gauges as-is (not summed) and collect the pod set.
 */
export function aggregateDevicesDcgm(fams: Families, exporterNode: string): GpuDevice[] {
  const accs = new Map<string, DevAcc>();
  for (const name of DEVICE_DCGM) {
    for (const m of fams.get(name) ?? []) {
      const l = m.labels;
      let gpu = l.gpu || l.device || l.UUID || "?";
      if (l.GPU_I_ID) gpu = `${gpu}:${l.GPU_I_ID}`;
      const node = l.Hostname || exporterNode;
      const k = devKey(node, gpu);
      let acc = accs.get(k);
      if (!acc) {
        acc = newDev(node, gpu);
        accs.set(k, acc);
      }
      const d = acc.dev;
      if (l.UUID && !d.uuid) d.uuid = l.UUID;
      if (l.modelName && !d.model) d.model = l.modelName;
      if (l.GPU_I_PROFILE && !d.migProfile) d.migProfile = l.GPU_I_PROFILE;
      const ns = l.namespace || l.exported_namespace;
      const pod = l.pod || l.exported_pod;
      if (ns && pod) acc.pods.add(`${ns}/${pod}`);
      // Gauges repeat per pod label set; keep the max rather than summing.
      switch (name) {
        case "DCGM_FI_DEV_GPU_UTIL":
          d.utilPct = Math.max(d.utilPct, m.value);
          break;
        case "DCGM_FI_PROF_GR_ENGINE_ACTIVE":
          d.utilPct = Math.max(d.utilPct, m.value * 100);
          break;
        case "DCGM_FI_DEV_FB_USED":
          d.vramUsedMiB = Math.max(d.vramUsedMiB, m.value);
          break;
        case "DCGM_FI_DEV_FB_FREE":
          acc.fbTotal = Math.max(acc.fbTotal ?? 0, m.value); // temporarily holds FREE
          break;
        case "DCGM_FI_DEV_FB_TOTAL":
          d.vramTotalMiB = Math.max(d.vramTotalMiB, m.value);
          break;
        case "DCGM_FI_DEV_POWER_USAGE":
          d.powerWatts = Math.max(d.powerWatts, m.value);
          break;
        case "DCGM_FI_DEV_GPU_TEMP":
          d.tempC = Math.max(d.tempC ?? 0, m.value);
          break;
      }
    }
  }
  const out: GpuDevice[] = [];
  for (const acc of accs.values()) {
    if (acc.dev.vramTotalMiB === 0) acc.dev.vramTotalMiB = acc.dev.vramUsedMiB + (acc.fbTotal ?? 0);
    acc.dev.pods = [...acc.pods].sort();
    out.push(acc.dev);
  }
  return out;
}

/**
 * Per-process exporter: device totals come from gpu_total_* / gpu_power_*
 * (per uuid), usage is the sum of process memory, util is the device-level
 * gauge when present, else the max process util.
 */
export function aggregateDevicesEnricher(results: EnricherResult[]): GpuDevice[] {
  const byUuid = new Map<string, DevAcc & { procUtilMax: number; hasTotalUtil: boolean }>();
  const get = (uuid: string, node: string, gpu: string, model?: string) => {
    let a = byUuid.get(uuid);
    if (!a) {
      a = { ...newDev(node, gpu || "?"), procUtilMax: 0, hasTotalUtil: false };
      a.dev.uuid = uuid;
      byUuid.set(uuid, a);
    }
    if (model && !a.dev.model) a.dev.model = model;
    if (a.dev.gpu === "?" && gpu) a.dev.gpu = gpu;
    return a;
  };
  const MIB = 1024 * 1024;
  for (const r of results) {
    for (const m of r.fams.get("gpu_process_memory_bytes") ?? []) {
      const { uuid, gpu = "", model, namespace, pod } = m.labels;
      if (!uuid) continue;
      const a = get(uuid, r.node, gpu, model);
      a.dev.vramUsedMiB += m.value / MIB;
      if (namespace && pod) a.pods.add(`${namespace}/${pod}`);
    }
    for (const m of r.fams.get("gpu_process_utilization_percent") ?? []) {
      const { uuid, gpu = "", model } = m.labels;
      if (!uuid) continue;
      const a = get(uuid, r.node, gpu, model);
      a.procUtilMax = Math.max(a.procUtilMax, m.value);
    }
    for (const m of r.fams.get("gpu_total_memory_bytes") ?? []) {
      const { uuid, gpu = "", model } = m.labels;
      if (!uuid) continue;
      get(uuid, r.node, gpu, model).dev.vramTotalMiB = m.value / MIB;
    }
    for (const m of r.fams.get("gpu_total_utilization_percent") ?? []) {
      const { uuid, gpu = "", model } = m.labels;
      if (!uuid) continue;
      const a = get(uuid, r.node, gpu, model);
      a.dev.utilPct = m.value;
      a.hasTotalUtil = true;
    }
    for (const m of r.fams.get("gpu_power_usage_watts") ?? []) {
      const { uuid, gpu = "", model } = m.labels;
      if (!uuid) continue;
      get(uuid, r.node, gpu, model).dev.powerWatts = m.value;
    }
    for (const m of r.fams.get("gpu_temperature_celsius") ?? []) {
      const { uuid, gpu = "", model } = m.labels;
      if (!uuid) continue;
      get(uuid, r.node, gpu, model).dev.tempC = m.value;
    }
  }
  const out: GpuDevice[] = [];
  for (const a of byUuid.values()) {
    if (!a.hasTotalUtil) a.dev.utilPct = a.procUtilMax;
    a.dev.pods = [...a.pods].sort();
    out.push(a.dev);
  }
  return out;
}

/** Display order for devices: node, then GPU index (MIG slices under their card). */
export function sortDevices(devs: GpuDevice[]): GpuDevice[] {
  const key = (d: GpuDevice) =>
    d.gpu
      .split(":")
      .map((p) => p.padStart(3, "0"))
      .join(":");
  return [...devs].sort((a, b) => {
    if (a.node !== b.node) return a.node < b.node ? -1 : 1;
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}
