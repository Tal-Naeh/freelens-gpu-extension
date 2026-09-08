# freelens-gpu-extension

Per-pod **GPU usage inside [Freelens](https://freelens.app)**: utilisation, VRAM and power for every pod that holds a GPU, plus a GPU section in the Pod and Node detail drawers.

Zero cluster footprint. The extension auto-discovers a GPU metrics exporter you already run (NVIDIA **dcgm-exporter** from the GPU Operator, or any **per-process exporter** emitting `gpu_process_memory_bytes`) and scrapes it through the kube-apiserver **pod-proxy subresource**, using the same cluster connection Freelens already has. No DaemonSet, no port-forward, no Prometheus required.

It is the GUI counterpart of [`kubectl-gpugo`](https://github.com/Tal-Naeh/kubectl-gpugo) (`kubectl krew install gpugo`) and shares its attribution rules and data model, so both tools show the same numbers.

## What you get

A **GPU** group in the cluster sidebar with five views, all fed by the same 20 s scrape:

| View | Question it answers |
|------|---------------------|
| **Pods** | Which pods hold GPUs right now, on which card / MIG slice, at what utilisation, VRAM and power. Sorted by physical GPU so pile-ups are obvious. |
| **GPUs** | One row per physical GPU or MIG slice: model, MIG profile, utilisation, VRAM used / total / %, power, temperature, and the pods sharing it. Cards with no pod are listed too. |
| **Idle & waste** | Pods holding VRAM at under 5 % utilisation, with how long they have been idle (history kept while Freelens is open). The first place to look before buying more GPUs. |
| **Allocation** | Per node: `nvidia.com/gpu` capacity and allocatable vs what running pods request vs what the exporters actually measure as busy. Shows scheduler view and reality side by side. |
| **Exporters** | What discovery found: each exporter's kind, node, scrape latency and body size, plus every candidate probed and why it was or wasn't accepted. |

Every table sorts on header click, resizes by dragging the header edge (double-click resets, widths are remembered), keeps its header visible while scrolling, and shows the full text of a truncated cell on hover.

Also:
- **Pod details drawer**: a GPU section for pods that hold a GPU (silent for the rest).
- **Node details drawer**: device summary (count, model, VRAM, power, max temperature) plus every GPU row on that node.
- The page title carries the extension version so you always know what you are looking at.

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
