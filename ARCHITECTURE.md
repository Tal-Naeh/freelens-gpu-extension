# Architecture

Everything runs in the **Renderer** (the cluster frame). There is no Main-process engine and no IPC: the data source
is the kube-apiserver itself, reached through Freelens' proxy, so the renderer can do the whole job.

| Layer | Location | Role |
| --- | --- | --- |
| Entry | `src/renderer/index.tsx` | Registers the GPU sidebar group, five cluster pages, and Pod/Node detail items. |
| Data | `src/renderer/gpu/` | `scraper.ts` (discovery + pod-proxy fetch), `prom.ts` (Prometheus text parser), `aggregate.ts` (attribution rules), `store.ts` (MobX store, polling, history, derived views), `types.ts`. |
| UI | `src/renderer/components/`, `src/renderer/pages/` | `DataGrid` (sortable/resizable CSS grid), `PageShell` (title, version, status, refresh, scrolling body), one page per view, drawer sections. |
| Main | `src/main/index.ts` | Empty `Main.LensExtension`; present because Freelens loads both entry points. |

## Data path

```text
podsApi.list()  ──▶ candidates (Running, name/image/labels ∋ dcgm|gpu|nvidia|cuda, metrics port)
                        │  fetch(`/api-kube/api/v1/namespaces/<ns>/pods/<pod>:<port>/proxy/metrics`)
                        ▼
                classifyMetrics(body) ──▶ ExporterPod{kind: dcgm | enricher}     (cached 60 s)
                        │
        every 20 s      ▼
                fetch /metrics for each exporter ──▶ parsePrometheusText ──▶ Families
                        │
                        ├─ buildEnricherRows / aggregateByPod / aggregateByGPU  ──▶ PodGPU[]   (Pods view, drawers)
                        ├─ aggregateDevicesDcgm / aggregateDevicesEnricher     ──▶ GpuDevice[] (GPUs view)
                        └─ requestedByNode (pod nvidia.com/gpu limits)          ┐
                nodesApi.list() capacity / allocatable                          ┴──▶ AllocationRow[] (Allocation view)
                store.history (per pod, 6 h, in memory)                        ──▶ IdleRow[]      (Idle & waste view)
                scraper.lastProbes + per-exporter latency/bytes/error           ──▶ Exporters view
```

## Attribution rules (shared with kubectl-gpugo)

1. A **per-process exporter** (`gpu_process_memory_bytes{namespace,pod,uuid,...}`) wins when present: it attributes
   even workloads that bypass the device plugin via `NVIDIA_VISIBLE_DEVICES=all`. Power is split per pod by VRAM share.
2. **dcgm-exporter with pod labels** (`--kubernetes`): one row per pod; MIG slices are keyed `gpu:GPU_I_ID` so pods on
   different slices of one card stay separate; `DCGM_FI_PROF_GR_ENGINE_ACTIVE` ×100 stands in for util on MIG.
3. **dcgm-exporter without pod labels**: one row per (node, GPU) with the node's `nvidia.com/gpu`-requesting pods as hints.

Devices take the **max** of repeated gauges (DCGM repeats a device's line once per attributed pod), never the sum.

## Why the relative `/api-kube` fetch

Inside a cluster frame the window origin is Freelens' proxy for that cluster and `/api-kube/*` is forwarded to the
kube-apiserver with the kubeconfig's credentials. The typed `Renderer.K8sApi.KubeJsonApi.forCluster` exists in the
1.10.3 typings but not at runtime, so it is only used when actually present.
