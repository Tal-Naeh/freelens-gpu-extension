/**
 * MobX store holding the latest GPU snapshot for the active cluster frame,
 * a rolling in-memory history (for the idle/waste view), and the node
 * allocation view (nvidia.com/gpu capacity vs requested vs measured).
 * One instance per cluster frame.
 */

import { Renderer } from "@freelensapp/extensions";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { sortDevices, sortRows } from "./aggregate";
import { GpuScraper, type ProbeResult } from "./scraper";

import type { AllocationRow, GpuDevice, HistoryPoint, IdleRow, PodGPU, Snapshot } from "./types";

export const DEFAULT_INTERVAL_MS = 20_000;
const STALE_MS = 30_000;
const HISTORY_MS = 6 * 60 * 60_000; // keep up to 6h of samples per pod
export const IDLE_UTIL_PCT = 5;
export const IDLE_MIN_VRAM_MIB = 256;

interface NodeInfo {
  name: string;
  gpuType?: string;
  capacity: number;
  allocatable: number;
}

export class GpuStore {
  @observable.ref snapshot: Snapshot | undefined = undefined;
  @observable error: string | undefined = undefined;
  @observable loading = false;
  @observable.ref nodes: NodeInfo[] = [];
  @observable nodesError: string | undefined = undefined;
  /** Rolling per-pod history, keyed "ns/pod". Bumped via historyVersion for observers. */
  readonly history = new Map<string, HistoryPoint[]>();
  @observable historyVersion = 0;

  private timer: ReturnType<typeof setInterval> | undefined;
  private inflight: Promise<void> | undefined;
  private subscribers = 0;

  constructor(readonly scraper = new GpuScraper()) {
    makeObservable(this);
  }

  @computed get rows(): PodGPU[] {
    return this.snapshot ? sortRows(this.snapshot.rows) : [];
  }

  @computed get devices(): GpuDevice[] {
    return this.snapshot ? sortDevices(this.snapshot.gpus) : [];
  }

  get probes(): ProbeResult[] {
    return this.scraper.lastProbes;
  }

  rowsForPod(namespace: string, name: string): PodGPU[] {
    return this.rows.filter(
      (r) => (r.namespace === namespace && r.pod === name) || r.hintPods?.includes(`${namespace}/${name}`),
    );
  }

  rowsForNode(node: string): PodGPU[] {
    return this.rows.filter((r) => r.node === node);
  }

  devicesForNode(node: string): GpuDevice[] {
    return this.devices.filter((d) => d.node === node);
  }

  /** Pods currently holding VRAM at (near) zero utilisation, with how long we have seen them idle. */
  @computed get idleRows(): IdleRow[] {
    void this.historyVersion; // subscribe to history updates
    const out: IdleRow[] = [];
    for (const r of this.rows) {
      if (r.gpuIndex) continue; // fallback rows have no pod identity
      if (r.gpuUtilPct >= IDLE_UTIL_PCT || r.vramUsedMiB < IDLE_MIN_VRAM_MIB) continue;
      const h = this.history.get(`${r.namespace}/${r.pod}`) ?? [];
      // walk back from the newest sample while util stays below threshold
      let i = h.length - 1;
      let peak = 0;
      while (i >= 0 && h[i].utilPct < IDLE_UTIL_PCT) {
        peak = Math.max(peak, h[i].utilPct);
        i--;
      }
      const idleSince = h[i + 1]?.t ?? Date.now();
      const samples = h.length - 1 - i;
      out.push({
        ...r,
        idleMinutes: Math.max(0, (Date.now() - idleSince) / 60_000),
        samples,
        peakUtilPct: peak,
      });
    }
    return out.sort((a, b) => b.vramUsedMiB - a.vramUsedMiB);
  }

  /** Per node: nvidia.com/gpu capacity / allocatable / requested vs measured devices. */
  @computed get allocation(): AllocationRow[] {
    const snap = this.snapshot;
    const byNode = new Map<string, AllocationRow>();
    const ensure = (name: string) => {
      let a = byNode.get(name);
      if (!a) {
        a = {
          node: name,
          capacity: 0,
          allocatable: 0,
          requested: 0,
          requestingPods: [],
          devices: 0,
          busyDevices: 0,
          avgUtilPct: 0,
          vramUsedMiB: 0,
          vramTotalMiB: 0,
          powerWatts: 0,
        };
        byNode.set(name, a);
      }
      return a;
    };
    for (const n of this.nodes) {
      if (n.capacity === 0 && n.allocatable === 0) continue;
      const a = ensure(n.name);
      a.gpuType = n.gpuType;
      a.capacity = n.capacity;
      a.allocatable = n.allocatable;
    }
    if (snap) {
      for (const [node, r] of Object.entries(snap.requestedByNode)) {
        const a = ensure(node);
        a.requested = r.gpus;
        a.requestingPods = r.pods;
      }
      const utilSum = new Map<string, number>();
      for (const d of this.devices) {
        const a = ensure(d.node);
        a.devices++;
        if (d.utilPct >= IDLE_UTIL_PCT || d.pods.length > 0) a.busyDevices++;
        a.vramUsedMiB += d.vramUsedMiB;
        a.vramTotalMiB += d.vramTotalMiB;
        a.powerWatts += d.powerWatts;
        utilSum.set(d.node, (utilSum.get(d.node) ?? 0) + d.utilPct);
        if (!a.gpuType && d.model) a.gpuType = d.model;
      }
      for (const a of byNode.values()) {
        if (a.devices > 0) a.avgUtilPct = (utilSum.get(a.node) ?? 0) / a.devices;
      }
    }
    return [...byNode.values()].sort((x, y) => (x.node < y.node ? -1 : 1));
  }

  get isStale(): boolean {
    return !this.snapshot || Date.now() - this.snapshot.scrapedAt.getTime() > STALE_MS;
  }

  /** Refresh now (deduplicated while a scrape is in flight). */
  refresh(force = false): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.doRefresh(force).finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  ensureFresh(): Promise<void> {
    return this.isStale ? this.refresh() : Promise.resolve();
  }

  @action private setLoading(v: boolean) {
    this.loading = v;
  }

  private recordHistory(snap: Snapshot) {
    const t = snap.scrapedAt.getTime();
    const cutoff = t - HISTORY_MS;
    for (const r of snap.rows) {
      if (r.gpuIndex) continue;
      const k = `${r.namespace}/${r.pod}`;
      const h = this.history.get(k) ?? [];
      h.push({ t, utilPct: r.gpuUtilPct, vramUsedMiB: r.vramUsedMiB });
      while (h.length > 0 && h[0].t < cutoff) h.shift();
      this.history.set(k, h);
    }
    // drop pods that vanished
    const live = new Set(snap.rows.map((r) => `${r.namespace}/${r.pod}`));
    for (const k of [...this.history.keys()]) if (!live.has(k)) this.history.delete(k);
  }

  private async loadNodes() {
    try {
      const list = (await Renderer.K8sApi.nodesApi.list()) ?? [];
      const infos: NodeInfo[] = list.map((n) => {
        const cap = (n.status?.capacity as Record<string, string> | undefined)?.["nvidia.com/gpu"];
        const alloc = (n.status?.allocatable as Record<string, string> | undefined)?.["nvidia.com/gpu"];
        const labels = n.metadata.labels ?? {};
        const gpuType =
          labels["nvidia.com/gpu.product"] ??
          labels["gpu-type"] ??
          labels["cloud.google.com/gke-accelerator"] ??
          labels["accelerator"];
        return { name: n.getName(), gpuType, capacity: Number(cap ?? 0) || 0, allocatable: Number(alloc ?? 0) || 0 };
      });
      runInAction(() => {
        this.nodes = infos;
        this.nodesError = undefined;
      });
    } catch (e) {
      runInAction(() => {
        this.nodesError = e instanceof Error ? e.message : String(e);
      });
    }
  }

  private async doRefresh(force: boolean) {
    this.setLoading(true);
    try {
      const [snap] = await Promise.all([this.scraper.snapshot(force), this.loadNodes()]);
      this.recordHistory(snap);
      runInAction(() => {
        this.snapshot = snap;
        this.error = undefined;
        this.historyVersion++;
      });
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : String(e);
      });
    } finally {
      this.setLoading(false);
    }
  }

  /**
   * Reference-counted polling: the first subscriber starts the ticker, the
   * last one stops it. Pages and detail panels call this on mount/unmount.
   */
  subscribe(intervalMs = DEFAULT_INTERVAL_MS): () => void {
    this.subscribers++;
    if (!this.timer) {
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), intervalMs);
    }
    return () => {
      this.subscribers--;
      if (this.subscribers <= 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
        this.subscribers = 0;
      }
    };
  }
}

export const gpuStore = new GpuStore();
