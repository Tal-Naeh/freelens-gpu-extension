import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { gpuStore } from "../gpu/store";
import { GpuTable } from "./gpu-table";
import { gpuStyles } from "./styles";

const { Button, Spinner } = Renderer.Component;

export interface GpuPageProps {
  extension: Renderer.LensExtension;
}

export const GpuPage = observer(({ extension }: GpuPageProps) => {
  React.useEffect(() => gpuStore.subscribe(), []);
  const snap = gpuStore.snapshot;
  const rows = gpuStore.rows;

  return (
    <div className="gpuext-page">
      <style>{gpuStyles}</style>
      <div className="gpuext-header">
        <h2>
          GPU usage by pod <span className="gpuext-version">v{extension.version}</span>
        </h2>
        <span className="gpuext-status">
          {snap
            ? `${snap.exporters.length} exporter${snap.exporters.length === 1 ? "" : "s"} (${[...new Set(snap.exporters.map((e) => e.kind))].join(", ")}) · last scrape ${snap.scrapedAt.toLocaleTimeString()}`
            : gpuStore.loading
              ? "discovering exporters…"
              : ""}
        </span>
        <div className="gpuext-actions">
          {gpuStore.loading && <Spinner />}
          <Button plain label="Refresh" disabled={gpuStore.loading} onClick={() => void gpuStore.refresh(true)} />
        </div>
      </div>

      {gpuStore.error && <div className="gpuext-error">{gpuStore.error}</div>}

      <div className="gpuext-body">
        {snap && rows.length === 0 && !gpuStore.error && (
          <div className="gpuext-empty">Exporters found, but no GPU metrics were returned.</div>
        )}

        {rows.length > 0 && <GpuTable rows={rows} />}

        {snap?.mode === "gpu" && (
          <div className="gpuext-hint">
            dcgm-exporter is not emitting pod labels, so rows are per (node, GPU). The arrow lists pods on that node
            requesting <code>nvidia.com/gpu</code>. Enable <code>--kubernetes</code> on dcgm-exporter for per-pod
            attribution.
          </div>
        )}

        {!snap && !gpuStore.loading && !gpuStore.error && (
          <div className="gpuext-empty">Waiting for the first scrape…</div>
        )}
      </div>
    </div>
  );
});
