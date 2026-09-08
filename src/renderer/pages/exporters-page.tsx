import { observer } from "mobx-react";
import { type Column, DataGrid } from "../components/data-grid";
import { PageShell } from "../components/page-shell";
import { gpuStore } from "../gpu/store";

import type { Renderer } from "@freelensapp/extensions";

import type { ProbeResult } from "../gpu/scraper";
import type { ExporterScrape } from "../gpu/types";

const EXPORTER_COLUMNS: Column<ExporterScrape>[] = [
  { key: "ns", title: "Namespace", width: 150, min: 60, value: (e) => e.namespace },
  { key: "name", title: "Pod", width: 320, min: 80, value: (e) => e.name },
  { key: "port", title: "Port", width: 70, min: 50, num: true, value: (e) => e.port },
  {
    key: "kind",
    title: "Kind",
    width: 100,
    min: 60,
    value: (e) => e.kind,
    render: (e) => <span className="gpuext-badge">{e.kind === "dcgm" ? "dcgm-exporter" : "per-process"}</span>,
  },
  { key: "node", title: "Node", width: 220, min: 80, value: (e) => e.nodeName, className: "gpuext-dim" },
  {
    key: "latency",
    title: "Scrape",
    width: 90,
    min: 60,
    num: true,
    value: (e) => e.latencyMs ?? -1,
    render: (e) => (e.latencyMs === undefined ? "–" : `${e.latencyMs} ms`),
  },
  {
    key: "bytes",
    title: "Body",
    width: 90,
    min: 60,
    num: true,
    value: (e) => e.bytes ?? -1,
    render: (e) => (e.bytes === undefined ? "–" : `${(e.bytes / 1024).toFixed(0)} KiB`),
  },
  { key: "error", title: "Error", width: 360, min: 80, value: (e) => e.error ?? "", className: "gpuext-error-text" },
];

const PROBE_COLUMNS: Column<ProbeResult>[] = [
  { key: "target", title: "Candidate (ns/pod:port)", width: 420, min: 100, value: (p) => p.target },
  { key: "outcome", title: "Outcome", width: 120, min: 60, value: (p) => p.outcome },
  { key: "detail", title: "Detail", width: 600, min: 100, value: (p) => p.detail ?? "", className: "gpuext-dim" },
];

export const ExportersPage = observer(({ extension }: { extension: Renderer.LensExtension }) => {
  const snap = gpuStore.snapshot;
  const exporters = snap?.exporters ?? [];
  const probes = gpuStore.probes;
  return (
    <PageShell
      extension={extension}
      title="Exporters"
      subtitle={
        <>
          How GPU metrics reach this view. Discovery lists pods, keeps Running ones whose name/image/labels mention
          dcgm, gpu, nvidia or cuda, probes each <code>/metrics</code> through the apiserver pod-proxy and classifies by
          content. Discovery is cached for 60 s; Refresh re-runs it.
        </>
      }
    >
      <h3 className="gpuext-h3">Scraped exporters ({exporters.length})</h3>
      <DataGrid
        id="exporters"
        columns={EXPORTER_COLUMNS}
        rows={exporters}
        rowKey={(e) => `${e.namespace}/${e.name}`}
        defaultSort={{ key: "node", dir: "asc" }}
        emptyText="No exporter scraped."
      />
      <h3 className="gpuext-h3">Last discovery probes ({probes.length})</h3>
      <DataGrid
        id="probes"
        columns={PROBE_COLUMNS}
        rows={probes}
        rowKey={(p) => p.target}
        defaultSort={{ key: "target", dir: "asc" }}
        emptyText="No candidates were probed."
      />
    </PageShell>
  );
});
