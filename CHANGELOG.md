# Changelog

## 0.3.5

- Fix: time-slicing replicas (`nvidia.com/gpu.shared`, `nvidia.com/mig-*.shared`) are no longer counted as extra devices
  in node capacity / allocatable or in "Requested", which would inflate Allocation on time-sliced nodes. Pods requesting
  them still count as GPU pods (requesting-pods list, fallback-mode hints).
- Verified 0.3.4 against a live DGX A100 (47 MIG slices + 1 whole GPU): power total 805 W (was 5,033 W summed per slice),
  Allocation capacity 48 / requested 29 (was 1 / 0).

## 0.3.4

- Fix: pod GPU % no longer double-counts on non-MIG cards that emit both `DCGM_FI_DEV_GPU_UTIL` and
  `DCGM_FI_PROF_GR_ENGINE_ACTIVE` (DCP metrics on, e.g. A100/H100): `GPU_UTIL` wins, `GR_ENGINE_ACTIVE` only fills in
  for MIG slices. Previously such a pod could show well over 100%.
- Fix: power totals (GPUs subtitle, Node drawer, Allocation) count each physical card once instead of once per MIG slice.
- Fix: `mig.strategy=mixed` clusters: pod requests and node capacity/allocatable now include `nvidia.com/mig-*`
  resources, so Allocation, fallback-mode pod hints and "requested" are no longer zero on MIG nodes.
- Fix: DCGM samples are attributed to the exporter pod's node; the `Hostname` label (the exporter pod name unless
  `NODE_NAME` is set) is only a fallback. Node drawer and Allocation no longer miss or duplicate such nodes.
- Fix: clusters running both a per-process exporter and dcgm-exporter keep the pods on DCGM-only nodes in the Pods view.
- Fix: fallback-mode rows (no pod labels) on different nodes no longer share a React key, which could drop rows.
- Fix: "Peak in window" on Idle & waste reports the peak over the retained history, not only the idle stretch (which
  was always under 5%).
- Fix: a failed exporter scrape re-runs discovery on the next tick instead of reusing a stale pod for up to 60 s.
- UI: table row borders line up across columns (cells stretch to the row height; empty cells and GPU badges no longer
  shift their border up or down).
- UI: the Node drawer table hides the Node column instead of showing it empty.
- Deps: override `dompurify` (≥3.4.16) and `decode-uri-component` (≥0.5.0), dev-only transitive deps of
  `@freelensapp/core`, clearing the Dependabot alerts.
- Docs: ARCHITECTURE.md attribution rules updated; Freelens v2 readiness checklist.

## 0.3.3

- Fix: the heavier group separator in every table now follows the sorted column (namespace, node, physical GPU,
  model, MIG profile, GPU type, outcome) instead of disappearing as soon as the sort left the default column.
  Columns with unique or continuous values (pod name, percentages, sizes) draw no separators.

## 0.3.2

- Docs: screenshots of the GPUs (MIG) and Idle & waste views in the README.
- UI: wider default widths for the "VRAM held" and "Peak in window" columns so the headers are not truncated.

## 0.3.1

- Fix: LICENSE copyright holder.
- Docs: README Features and Usage sections; repo homepage points at the npm page.

## 0.3.0

First published release, as `@tal-naeh/freelens-gpu-extension` on npm.

- Sidebar group **GPU** with five views: Pods, GPUs (per device / MIG slice), Idle & waste, Allocation, Exporters.
- Per-device aggregation for dcgm-exporter (model, MIG profile, temperature) and per-process exporters.
- Rolling in-memory history drives the Idle & waste view ("idle for" from consecutive samples).
- Allocation joins `nvidia.com/gpu` capacity / allocatable with running pods' requests and measured busy devices.
- Exporters view exposes discovery probes, scrape latency, body size and errors.
- Shared DataGrid: click-to-sort, drag-to-resize (double-click resets, widths persisted), sticky header, hover text.
- Version badge in every page title.
- Fix: scrape uses the relative `/api-kube` proxy path; `KubeJsonApi.forCluster` is declared in the 1.10.3 typings but
  missing at runtime.
- GPU sections in the Pod and Node detail drawers.

## 0.1.0

- Initial local-only build: Pods table, pod/node drawer sections, pod-proxy scraping of dcgm-exporter and
  per-process exporters.
