/**
 * "Whose GPUs are these?": GPU requests, measured use, idle holdings and
 * waiting pods rolled up per namespace, plus free MIG slices per profile.
 * Pure functions over snapshot data.
 */

import type { GpuRequests, PendingGpuPod, PodGPU } from "./types";

export interface NamespaceRow {
  namespace: string;
  /** Devices requested by running pods (whole GPUs + MIG slices). */
  requested: number;
  /** Requested per resource name. */
  byResource: Record<string, number>;
  /** Running pods that request a GPU. */
  gpuPods: number;
  /** Devices the exporters attribute to this namespace's pods. */
  devicesInUse: number;
  /** Mean GPU util over this namespace's attributed pods. */
  avgUtilPct: number;
  vramUsedMiB: number;
  /** Pods counted idle on the Idle & waste view, and the VRAM they hold. */
  idlePods: number;
  idleVramMiB: number;
  pending: number;
  powerWatts: number;
  /** Some pods sit on shared devices: their util/power are device-level, so the power total over-counts. */
  shared: boolean;
}

export function aggregateNamespaces(
  requestedByNamespace: Record<string, GpuRequests>,
  rows: PodGPU[],
  idle: PodGPU[],
  pending: PendingGpuPod[],
): NamespaceRow[] {
  const by = new Map<string, NamespaceRow & { utilSum: number; utilN: number }>();
  const get = (ns: string) => {
    let r = by.get(ns);
    if (!r) {
      r = {
        namespace: ns,
        requested: 0,
        byResource: {},
        gpuPods: 0,
        devicesInUse: 0,
        avgUtilPct: 0,
        vramUsedMiB: 0,
        idlePods: 0,
        idleVramMiB: 0,
        pending: 0,
        powerWatts: 0,
        shared: false,
        utilSum: 0,
        utilN: 0,
      };
      by.set(ns, r);
    }
    return r;
  };
  for (const [ns, q] of Object.entries(requestedByNamespace)) {
    const r = get(ns);
    r.requested = q.gpus;
    r.byResource = { ...q.byResource };
    r.gpuPods = q.pods.length;
  }
  for (const p of rows) {
    if (p.gpuIndex) continue; // per-(node, GPU) fallback rows have no namespace
    const r = get(p.namespace);
    r.devicesInUse += p.gpuCount;
    r.vramUsedMiB += p.vramUsedMiB;
    r.powerWatts += p.powerWatts;
    r.utilSum += p.gpuUtilPct;
    r.utilN++;
    if ((p.sharedWith ?? 1) > 1) r.shared = true;
  }
  for (const p of idle) {
    const r = get(p.namespace);
    r.idlePods++;
    r.idleVramMiB += p.vramUsedMiB;
  }
  for (const p of pending) get(p.namespace).pending++;
  return [...by.values()]
    .map(({ utilSum, utilN, ...r }) => ({ ...r, avgUtilPct: utilN > 0 ? utilSum / utilN : 0 }))
    .sort((a, b) => b.requested - a.requested || b.vramUsedMiB - a.vramUsedMiB || (a.namespace < b.namespace ? -1 : 1));
}

export interface MigFree {
  /** Profile without the resource prefix, e.g. "1g.10gb". */
  profile: string;
  free: number;
  total: number;
}

/**
 * Free MIG slices per profile on one node: allocatable minus what running pods
 * request. `*.shared` replicas are skipped (they are not extra slices).
 */
export function migFree(allocatable: Record<string, number>, requested: Record<string, number>): MigFree[] {
  return Object.entries(allocatable)
    .filter(([k, v]) => k.startsWith("nvidia.com/mig-") && !k.endsWith(".shared") && v > 0)
    .map(([k, total]) => ({
      profile: k.slice("nvidia.com/mig-".length),
      total,
      free: Math.max(0, total - (requested[k] ?? 0)),
    }))
    .sort((a, b) => b.total - a.total);
}
