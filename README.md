# freelens-gpu-extension

Per-pod **GPU usage inside [Freelens](https://freelens.app)**: utilisation, VRAM and power for every pod that holds a GPU, plus a GPU section in the Pod and Node detail drawers.

Zero cluster footprint. The extension auto-discovers a GPU metrics exporter you already run (NVIDIA **dcgm-exporter** from the GPU Operator, or any **per-process exporter** emitting `gpu_process_memory_bytes`) and scrapes it through the kube-apiserver **pod-proxy subresource**, using the same cluster connection Freelens already has. No DaemonSet, no port-forward, no Prometheus required.

It is the GUI counterpart of [`kubectl-gpugo`](https://github.com/Tal-Naeh/kubectl-gpugo) (`kubectl krew install gpugo`) and shares its attribution rules and data model, so both tools show the same numbers.

## What you get

- **GPU** entry in the cluster sidebar: a table of every GPU-holding pod, sorted by physical GPU (MIG slices grouped under their card), with a utilisation bar, VRAM used/total and power.
- **Pod details drawer**: a GPU section for pods that hold a GPU (silent for the rest).
- **Node details drawer**: every GPU row on that node.
- Refreshes every 20 s while a GPU view is open; manual Refresh re-runs discovery.

| Column     | Meaning                                                                                   |
|------------|-------------------------------------------------------------------------------------------|
| GPU        | GPU index(es): `2` (single), `0`,`1` (two cards), `0:8` (MIG slice 8 of GPU 0)              |
| GPU %      | Activity across the pod's GPUs (DCGM `GPU_UTIL`, or `PROF_GR_ENGINE_ACTIVE` on MIG)        |
| VRAM used  | Framebuffer used, summed across the pod's GPUs / slices                                   |
| VRAM total | Used + free framebuffer for those GPUs / slices                                           |
| Power      | Watts; on shared GPUs, a proportional share by VRAM                                       |

## Requirements

- An exporter the extension recognises, running in the cluster:
  - **dcgm-exporter**: image contains `dcgm-exporter`, or `/metrics` emits `DCGM_FI_DEV_*`. Per-pod attribution needs `--kubernetes` (the GPU Operator default); without it you get per-(node, GPU) rows with the candidate pods listed.
  - **Per-process exporter**: anything whose `/metrics` emits `gpu_process_memory_bytes` with `namespace`/`pod` labels. Preferred when present, because it attributes workloads that bypass the device plugin via `NVIDIA_VISIBLE_DEVICES=all`.
- RBAC for the kubeconfig user: `list pods` cluster-wide (discovery) and `get pods/proxy` in the exporter's namespace (the scrape).

## Install

**From Freelens:** *File → Extensions* (⌘⇧E / Ctrl+Shift+E), paste `freelens-gpu-extension`, press **Install**.

**From a tarball:** download `freelens-gpu-extension-<version>.tgz` from the [releases page](https://github.com/Tal-Naeh/freelens-gpu-extension/releases) and drag it onto the Extensions page.

Requires Freelens ≥ 1.8.

## Development

```sh
pnpm install
pnpm test          # parser + aggregation tests against the fixtures in src/renderer/gpu/__tests__/fixtures
pnpm build         # type-check + build to out/
pnpm pack          # production build + .tgz you can drag into Freelens
```

For a fully local end-to-end run without a GPU, any pod named like `*dcgm-exporter*` that serves a DCGM-style Prometheus text file on `/metrics` (nginx + a ConfigMap on a kind cluster works) is discovered and rendered exactly like the real DaemonSet.

### How it works

1. `Renderer.K8sApi.podsApi.list()` lists pods; candidates are Running pods whose name, image or labels mention `dcgm`, `gpu`, `nvidia` or `cuda`.
2. Each candidate's `/metrics` is fetched via `KubeJsonApi.forCluster(clusterId).get("/api/v1/namespaces/<ns>/pods/<pod>:<port>/proxy/metrics")` and classified by content.
3. Metrics are parsed with a tiny built-in Prometheus text parser and aggregated per pod (`src/renderer/gpu/aggregate.ts`, a port of kubectl-gpugo's scraper).
4. A MobX store polls while a GPU view is mounted and feeds the page and the detail drawers.

## Limitations

- Time-slicing (not MIG) on dcgm-exporter reports identical per-GPU numbers for every pod sharing the card; only a per-process exporter can split those.
- Auto-discovery is keyword + content based. An exporter with an unusual name **and** unusual metric families is skipped.
- Freelens must be able to reach the pod-proxy subresource with your kubeconfig's RBAC; restricted tokens without `pods/proxy` cannot work.

## License

MIT
