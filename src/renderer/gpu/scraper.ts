/**
 * Exporter discovery + scraping from inside the Freelens renderer.
 *
 * Same strategy as kubectl-gpugo: list pods, keep the ones whose name /
 * image / labels look GPU-related, probe each candidate's /metrics through
 * the kube-apiserver pod-proxy subresource, and classify by the metric
 * families it emits. Nothing is installed in the cluster.
 *
 * All requests go through Freelens' own cluster connection
 * (KubeJsonApi.forCluster), so they carry whatever auth the kubeconfig has.
 */

import { Common, Renderer } from "@freelensapp/extensions";
import { aggregateByGPU, aggregateByPod, buildEnricherRows, extractDcgmSamples } from "./aggregate";
import { classifyMetrics, parsePrometheusText } from "./prom";
import type { ExporterPod, PodGPU, Snapshot } from "./types";

type Pod = Renderer.K8sApi.Pod;

const GPU_KEYWORDS = ["dcgm", "gpu", "nvidia", "cuda"];
const PROBE_TIMEOUT_MS = 5_000;
const SCRAPE_TIMEOUT_MS = 15_000;
const DISCOVERY_TTL_MS = 60_000;

function metricsPath(ns: string, name: string, port: number): string {
  return `/api/v1/namespaces/${ns}/pods/${name}:${port}/proxy/metrics`;
}

function looksGpuRelated(pod: Pod): boolean {
  const hay = [
    pod.getName(),
    ...pod.getContainers().map((c) => c.image ?? ""),
    ...Object.entries(pod.metadata.labels ?? {}).flatMap(([k, v]) => [k, v]),
  ]
    .join(" ")
    .toLowerCase();
  return GPU_KEYWORDS.some((k) => hay.includes(k));
}

/** annotation prometheus.io/port > container port named "metrics" > first port. */
function metricsPort(pod: Pod): number {
  const ann = pod.metadata.annotations?.["prometheus.io/port"];
  if (ann && /^\d+$/.test(ann)) return Number(ann);
  const ports = pod.getContainers().flatMap((c) => c.ports ?? []);
  const named = ports.find((p) => p.name === "metrics");
  if (named) return named.containerPort;
  return ports[0]?.containerPort ?? 0;
}

function requestsGpu(pod: Pod): boolean {
  return pod.getContainers().some((c) => {
    const r = c.resources ?? {};
    const lim = (r.limits as Record<string, string> | undefined)?.["nvidia.com/gpu"];
    const req = (r.requests as Record<string, string> | undefined)?.["nvidia.com/gpu"];
    return Number(lim ?? 0) > 0 || Number(req ?? 0) > 0;
  });
}

export interface ScraperDeps {
  clusterId: () => string | undefined;
  listPods: () => Promise<Pod[]>;
  fetchText: (clusterId: string, path: string, timeoutMs: number) => Promise<string>;
}

const defaultDeps: ScraperDeps = {
  clusterId: () => Renderer.Catalog.getActiveCluster()?.id ?? Renderer.Catalog.activeCluster.get()?.getId(),
  listPods: async () => (await Renderer.K8sApi.podsApi.list()) ?? [],
  fetchText: async (clusterId, path, timeoutMs) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // Inside a cluster frame the window origin IS the Lens proxy for this
      // cluster, and /api-kube/* is forwarded to the kube-apiserver with the
      // kubeconfig's auth. This is the path Freelens itself uses.
      //
      // The typed KubeJsonApi.forCluster(clusterId) is only used when the
      // running Freelens actually provides it (1.10.3 declares it in the
      // typings but not at runtime).
      const forCluster = (Renderer.K8sApi.KubeJsonApi as unknown as { forCluster?: unknown }).forCluster;
      if (typeof forCluster === "function") {
        try {
          const api = Renderer.K8sApi.KubeJsonApi.forCluster(clusterId);
          const body = await api.get<unknown>(path, undefined, { signal: ctrl.signal });
          return typeof body === "string" ? body : JSON.stringify(body);
        } catch (e) {
          log.warn(`KubeJsonApi.forCluster GET ${path} failed, falling back to /api-kube: ${describe(e)}`);
        }
      }
      const res = await fetch(`/api-kube${path}`, { signal: ctrl.signal, credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for /api-kube${path}`);
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  },
};

const log = {
  info: (m: string) => Common.logger.info(`[freelens-gpu-extension] ${m}`),
  warn: (m: string) => Common.logger.warn(`[freelens-gpu-extension] ${m}`),
};

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export interface ProbeResult {
  target: string;
  outcome: "dcgm" | "enricher" | "unrecognised" | "error";
  detail?: string;
}

export class GpuScraper {
  private discovered: ExporterPod[] = [];
  private discoveredAt = 0;
  /** Pods requesting nvidia.com/gpu grouped by node, refreshed with discovery. */
  private gpuPodsByNode = new Map<string, string[]>();
  /** Outcome of the last discovery pass, for diagnostics in the UI and logs. */
  lastProbes: ProbeResult[] = [];
  lastCandidateCount = 0;
  lastPodCount = 0;

  constructor(private readonly deps: ScraperDeps = defaultDeps) {}

  /** Explicit exporter targets (bypass auto-discovery), "ns/pod:port". */
  explicit: { namespace: string; name: string; port: number }[] = [];

  invalidate() {
    this.discoveredAt = 0;
  }

  get exporters(): ExporterPod[] {
    return this.discovered;
  }

  async discover(force = false): Promise<ExporterPod[]> {
    if (!force && Date.now() - this.discoveredAt < DISCOVERY_TTL_MS && this.discovered.length > 0) {
      return this.discovered;
    }
    const clusterId = this.deps.clusterId();
    if (!clusterId) throw new Error("no active cluster");

    const pods = await this.deps.listPods();
    this.lastPodCount = pods.length;
    const byNode = new Map<string, string[]>();
    for (const p of pods) {
      if (p.getStatusPhase() === "Running" && requestsGpu(p)) {
        const n = p.getNodeName() ?? "";
        byNode.set(n, [...(byNode.get(n) ?? []), `${p.getNs()}/${p.getName()}`]);
      }
    }
    this.gpuPodsByNode = byNode;

    const candidates =
      this.explicit.length > 0
        ? this.explicit.map((e) => {
            const pod = pods.find((p) => p.getNs() === e.namespace && p.getName() === e.name);
            return { ns: e.namespace, name: e.name, port: e.port, node: pod?.getNodeName() ?? "" };
          })
        : pods
            .filter((p) => p.getStatusPhase() === "Running" && looksGpuRelated(p))
            .map((p) => ({ ns: p.getNs(), name: p.getName(), port: metricsPort(p), node: p.getNodeName() ?? "" }))
            .filter((c) => c.port > 0);

    this.lastCandidateCount = candidates.length;
    const probes: ProbeResult[] = [];
    const probed = await Promise.all(
      candidates.map(async (c): Promise<ExporterPod | undefined> => {
        const target = `${c.ns}/${c.name}:${c.port}`;
        try {
          const text = await this.deps.fetchText(clusterId, metricsPath(c.ns, c.name, c.port), PROBE_TIMEOUT_MS);
          const kind = classifyMetrics(text);
          if (!kind) {
            probes.push({ target, outcome: "unrecognised", detail: `${text.length} bytes, first line: ${text.split("\n")[0]?.slice(0, 80)}` });
            return undefined;
          }
          probes.push({ target, outcome: kind });
          return { namespace: c.ns, name: c.name, port: c.port, nodeName: c.node, kind };
        } catch (e) {
          probes.push({ target, outcome: "error", detail: describe(e) });
          return undefined;
        }
      }),
    );
    this.lastProbes = probes;
    this.discovered = probed.filter((x): x is ExporterPod => !!x);
    this.discoveredAt = Date.now();
    log.info(
      `discovery: ${pods.length} pods, ${candidates.length} candidates, ${this.discovered.length} exporters; ` +
        probes.map((p) => `${p.target}=${p.outcome}${p.detail ? ` (${p.detail})` : ""}`).join("; "),
    );
    return this.discovered;
  }

  async snapshot(force = false): Promise<Snapshot> {
    const exporters = await this.discover(force);
    const clusterId = this.deps.clusterId();
    if (!clusterId) throw new Error("no active cluster");
    if (exporters.length === 0) {
      const lines = [
        `No GPU metrics exporter found (${this.lastPodCount} pods listed, ${this.lastCandidateCount} GPU-looking candidates probed).`,
        "An exporter is recognised when its /metrics emits DCGM_FI_DEV_* or gpu_process_memory_bytes.",
        ...this.lastProbes.map((p) => `  ${p.target}: ${p.outcome}${p.detail ? ` — ${p.detail}` : ""}`),
      ];
      if (this.lastCandidateCount === 0 && this.lastPodCount === 0) {
        lines.push("  (no pods returned at all — check that this kubeconfig can list pods cluster-wide)");
      }
      throw new Error(lines.join("\n"));
    }

    const bodies = await Promise.all(
      exporters.map(async (ex) => {
        const text = await this.deps.fetchText(clusterId, metricsPath(ex.namespace, ex.name, ex.port), SCRAPE_TIMEOUT_MS);
        return { ex, fams: parsePrometheusText(text) };
      }),
    );

    const enrichers = bodies.filter((b) => b.ex.kind === "enricher");
    const dcgms = bodies.filter((b) => b.ex.kind === "dcgm");

    let rows: PodGPU[] = [];
    let mode: Snapshot["mode"] = "pod";
    if (enrichers.length > 0) {
      rows = buildEnricherRows(enrichers.map((b) => ({ fams: b.fams, node: b.ex.nodeName })));
    }
    if (rows.length === 0 && dcgms.length > 0) {
      const samples = dcgms.flatMap((b) => extractDcgmSamples(b.fams, b.ex.nodeName));
      rows = aggregateByPod(samples);
      if (rows.length === 0) {
        rows = aggregateByGPU(samples).map((r) => ({ ...r, hintPods: this.gpuPodsByNode.get(r.node) ?? [] }));
        if (rows.length > 0) mode = "gpu";
      }
    }
    return { scrapedAt: new Date(), mode, rows, exporters };
  }
}
