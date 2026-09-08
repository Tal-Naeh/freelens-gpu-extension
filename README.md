# Freelens GPU Extension

[![npm](https://img.shields.io/npm/v/%40tal-naeh%2Ffreelens-gpu-extension)](https://www.npmjs.com/package/@tal-naeh/freelens-gpu-extension)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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

## Installation

Open the Freelens **Extensions** page (`ctrl`+`shift`+`E` / `cmd`+`shift`+`E`), paste the npm name and click **Install**:

```text
@tal-naeh/freelens-gpu-extension
```

Alternatively download the `.tgz` from the
[GitHub releases](https://github.com/Tal-Naeh/freelens-gpu-extension/releases) page and drag it into the Freelens
window, or paste its absolute path on the Extensions page. After an upgrade, fully restart Freelens; the page title
shows the loaded version.

Requires Freelens ≥ 1.8 (developed and verified against 1.10.3).

## Development

```sh
pnpm install
pnpm type:check      # tsc
pnpm lint:check      # biome
pnpm knip:check      # unused files / deps / exports
pnpm test:unit       # vitest: parser + aggregation against the fixtures in src/renderer/gpu/__tests__/fixtures
pnpm build           # electron-vite → out/, then a Main-bundle smoke test
pnpm pack            # prepack runs the build, then writes the .tgz in the repo root
```

### Install a local build in Freelens

```sh
pnpm pack
# → tal-naeh-freelens-gpu-extension-<version>.tgz
```

Open Freelens → Extensions → paste the absolute path of the `.tgz` (or drag it into the window) → **Install** →
enable. Rebuild + reinstall to iterate, then fully restart Freelens.

### Try it without a GPU

Any pod named like `*dcgm-exporter*` that serves a DCGM-style Prometheus text file on `/metrics` (nginx + a
ConfigMap on a kind cluster works) is discovered and rendered exactly like the real DaemonSet. The fixture files under
`src/renderer/gpu/__tests__/fixtures/` are valid input.

### How it works

See [ARCHITECTURE.md](ARCHITECTURE.md). In short: `podsApi.list()` → keyword filter → probe each candidate's
`/metrics` through `/api-kube/api/v1/namespaces/<ns>/pods/<pod>:<port>/proxy/metrics` → classify by content → parse with
a tiny built-in Prometheus text parser → aggregate per pod and per device (a port of kubectl-gpugo's scraper) → a MobX
store polls every 20 s while a GPU view is mounted.

## Releasing

See [docs/publishing.md](docs/publishing.md): version bump → `vX.Y.Z` tag → CI stages the package on npm via Trusted
Publishing and creates the GitHub Release → a maintainer approves the staged version.

## Repository layout

- `src/renderer/gpu/` — `scraper.ts` (discovery, pod-proxy fetch), `prom.ts` (parser), `aggregate.ts` (attribution
  rules, shared with kubectl-gpugo), `store.ts` (polling, history, derived views), `types.ts`, `__tests__/`.
- `src/renderer/components/` — `DataGrid`, `PageShell`, utilisation bar, drawer sections, styles.
- `src/renderer/pages/` — Pods, GPUs, Idle & waste, Allocation, Exporters.
- `src/main/index.ts` — empty Main entry (required by Freelens).
- `scripts/smoke-main.cjs` — loads the built Main bundle with stubbed host globals after every build.

## Limitations

- Time-slicing (not MIG) on dcgm-exporter reports identical per-GPU numbers for every pod sharing the card; only a per-process exporter can split those.
- Auto-discovery is keyword + content based. An exporter with an unusual name **and** unusual metric families is skipped.
- Freelens must be able to reach the pod-proxy subresource with your kubeconfig's RBAC; restricted tokens without `pods/proxy` cannot work.

## License

MIT
