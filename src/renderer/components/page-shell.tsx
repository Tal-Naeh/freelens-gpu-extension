import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { gpuStore } from "../gpu/store";
import { gpuStyles } from "./styles";

const { Button, Spinner } = Renderer.Component;

export interface PageShellProps {
  extension: Renderer.LensExtension;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}

/** Common chrome for every GPU page: title + version badge, scrape status, refresh, scrolling body. */
export const PageShell = observer(({ extension, title, subtitle, children }: PageShellProps) => {
  React.useEffect(() => gpuStore.subscribe(), []);
  const snap = gpuStore.snapshot;
  const kinds = snap ? [...new Set(snap.exporters.map((e) => e.kind))].join(", ") : "";
  return (
    <div className="gpuext-page">
      <style>{gpuStyles}</style>
      <div className="gpuext-header">
        <h2>
          {title} <span className="gpuext-version">v{extension.version}</span>
        </h2>
        <span className="gpuext-status">
          {snap
            ? `${snap.exporters.length} exporter${snap.exporters.length === 1 ? "" : "s"} (${kinds}) · last scrape ${snap.scrapedAt.toLocaleTimeString()}`
            : gpuStore.loading
              ? "discovering exporters…"
              : ""}
        </span>
        <div className="gpuext-actions">
          {gpuStore.loading && <Spinner />}
          <Button plain label="Refresh" disabled={gpuStore.loading} onClick={() => void gpuStore.refresh(true)} />
        </div>
      </div>
      {subtitle && <div className="gpuext-hint gpuext-subtitle">{subtitle}</div>}
      {gpuStore.error && <div className="gpuext-error">{gpuStore.error}</div>}
      <div className="gpuext-body">
        {!snap && !gpuStore.loading && !gpuStore.error && (
          <div className="gpuext-empty">Waiting for the first scrape…</div>
        )}
        {snap && children}
      </div>
    </div>
  );
});
