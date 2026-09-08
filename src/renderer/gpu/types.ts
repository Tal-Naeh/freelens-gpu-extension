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

export interface Snapshot {
  scrapedAt: Date;
  mode: Mode;
  rows: PodGPU[];
  exporters: ExporterPod[];
}

export const isFallback = (r: PodGPU): boolean => !!r.gpuIndex;
export const vramTotalMiB = (r: PodGPU): number => r.vramUsedMiB + r.vramFreeMiB;
