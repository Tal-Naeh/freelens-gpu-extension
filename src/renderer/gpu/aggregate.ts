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
import type { PodGPU } from "./types";

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
