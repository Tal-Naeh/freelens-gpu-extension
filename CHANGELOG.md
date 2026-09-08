# Changelog

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
