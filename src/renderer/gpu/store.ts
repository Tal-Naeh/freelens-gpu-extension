/**
 * MobX store holding the latest GPU snapshot for the active cluster frame.
 * One instance per cluster frame (Freelens runs each cluster in its own
 * frame, so a module-level singleton is per-cluster in practice).
 */

import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { sortRows } from "./aggregate";
import { GpuScraper } from "./scraper";
import type { PodGPU, Snapshot } from "./types";

export const DEFAULT_INTERVAL_MS = 20_000;
const STALE_MS = 30_000;

export class GpuStore {
  @observable.ref snapshot: Snapshot | undefined = undefined;
  @observable error: string | undefined = undefined;
  @observable loading = false;

  private timer: ReturnType<typeof setInterval> | undefined;
  private inflight: Promise<void> | undefined;
  private subscribers = 0;

  constructor(private readonly scraper = new GpuScraper()) {
    makeObservable(this);
  }

  @computed get rows(): PodGPU[] {
    return this.snapshot ? sortRows(this.snapshot.rows) : [];
  }

  rowsForPod(namespace: string, name: string): PodGPU[] {
    return this.rows.filter(
      (r) => (r.namespace === namespace && r.pod === name) || r.hintPods?.includes(`${namespace}/${name}`),
    );
  }

  rowsForNode(node: string): PodGPU[] {
    return this.rows.filter((r) => r.node === node);
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

  /** Refresh only if the snapshot is missing or older than STALE_MS. */
  ensureFresh(): Promise<void> {
    return this.isStale ? this.refresh() : Promise.resolve();
  }

  @action private setLoading(v: boolean) {
    this.loading = v;
  }

  private async doRefresh(force: boolean) {
    this.setLoading(true);
    try {
      const snap = await this.scraper.snapshot(force);
      runInAction(() => {
        this.snapshot = snap;
        this.error = undefined;
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
