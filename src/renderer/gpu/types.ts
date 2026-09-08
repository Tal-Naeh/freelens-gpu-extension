/**
 * Shared data model. Mirrors kubectl-gpugo's scraper.PodGPU / Report so the
 * CLI's JSON output and this extension describe GPU usage identically.
 */

export type ExporterKind = "dcgm" | "enricher";

export interface ExporterPod {
  namespace: string;
  name: string;
  port: number;
  nodeName: string;
  kind: ExporterKind;
}

export interface PodGPU {
  namespace: string;
  pod: string;
  node: string;
  /** Set only in per-(node, GPU) fallback mode. */
  gpuIndex?: string;
  /** Candidate workloads in fallback mode ("ns/pod"). */
  hintPods?: string[];
  /** Sorted GPU indices used by this pod: "0", "1" or "0:8" (GPU 0, MIG slice 8). */
  gpus: string[];
  gpuCount: number;
  gpuUtilPct: number;
  vramUsedMiB: number;
  vramFreeMiB: number;
  powerWatts: number;
}

export type Mode = "pod" | "gpu";

/** One physical GPU, or one MIG slice when the card is partitioned. */
export interface GpuDevice {
  node: string;
  /** "0", or "0:8" for MIG slice 8 of card 0. */
  gpu: string;
  uuid?: string;
  model?: string;
  migProfile?: string;
  utilPct: number;
  vramUsedMiB: number;
  vramTotalMiB: number;
  powerWatts: number;
  tempC?: number;
  /** Workload pods seen on this device ("ns/pod"). */
  pods: string[];
}

export interface ExporterScrape extends ExporterPod {
  /** Round-trip of the last scrape in ms. */
  latencyMs?: number;
  bytes?: number;
  error?: string;
}

export interface Snapshot {
  scrapedAt: Date;
  mode: Mode;
  rows: PodGPU[];
  gpus: GpuDevice[];
  exporters: ExporterScrape[];
  /** nvidia.com/gpu requested (sum of container limits, falling back to requests) by node, from the pod list. */
  requestedByNode: Record<string, { gpus: number; pods: string[] }>;
}

export interface HistoryPoint {
  t: number;
  utilPct: number;
  vramUsedMiB: number;
}

export interface IdleRow extends PodGPU {
  /** Minutes the pod has been observed idle (util below threshold) in this session. */
  idleMinutes: number;
  /** Number of samples backing idleMinutes. */
  samples: number;
  /** Peak utilisation seen in the window. */
  peakUtilPct: number;
}

export interface AllocationRow {
  node: string;
  gpuType?: string;
  capacity: number;
  allocatable: number;
  requested: number;
  requestingPods: string[];
  /** Devices reporting on this node (0 if no exporter covers it). */
  devices: number;
  busyDevices: number;
  avgUtilPct: number;
  vramUsedMiB: number;
  vramTotalMiB: number;
  powerWatts: number;
}

export const isFallback = (r: PodGPU): boolean => !!r.gpuIndex;
export const vramTotalMiB = (r: PodGPU): number => r.vramUsedMiB + r.vramFreeMiB;
