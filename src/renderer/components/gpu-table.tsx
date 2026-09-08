import { physicalGPUGroup } from "../gpu/aggregate";
import { isFallback, type PodGPU, vramTotalMiB } from "../gpu/types";
import { fmtMiB } from "./styles";
import { UtilBar } from "./util-bar";

export interface GpuTableProps {
  rows: PodGPU[];
  /** Hide the namespace/pod/node columns when the context already implies them. */
  compact?: boolean;
}

/**
 * Rendered as a CSS grid rather than a <table>: the host app's table CSS
 * was misaligning headers and cells, and a grid guarantees every column
 * lines up by construction. Long names get an ellipsis and a hover title.
 */
export function GpuTable({ rows, compact }: GpuTableProps) {
  let prevGroup = "";
  const cls = `gpuext-grid ${compact ? "compact" : "full"}`;
  return (
    <div className={cls} role="table">
      <div className="gpuext-row gpuext-head" role="row">
        {!compact && <div className="gpuext-cell">Namespace</div>}
        {!compact && <div className="gpuext-cell">Pod</div>}
        {!compact && <div className="gpuext-cell">Node</div>}
        <div className="gpuext-cell">GPU</div>
        <div className="gpuext-cell">GPU %</div>
        <div className="gpuext-cell num">VRAM used</div>
        <div className="gpuext-cell num">VRAM total</div>
        <div className="gpuext-cell num">Power</div>
      </div>
      {rows.map((r) => {
        const group = physicalGPUGroup(r);
        const sep = prevGroup !== "" && group !== prevGroup;
        prevGroup = group;
        const key = `${r.namespace}/${r.pod}/${r.gpus.join(",")}`;
        const podText =
          isFallback(r) && r.hintPods && r.hintPods.length > 0 ? `${r.pod} → ${r.hintPods.join(", ")}` : r.pod;
        return (
          <div key={key} className={`gpuext-row${sep ? " gpuext-sep" : ""}`} role="row">
            {!compact && (
              <div className="gpuext-cell ellipsis" title={r.namespace}>
                {r.namespace}
              </div>
            )}
            {!compact && (
              <div className="gpuext-cell ellipsis" title={podText}>
                {r.pod}
                {isFallback(r) && r.hintPods && r.hintPods.length > 0 && (
                  <span className="gpuext-dim"> → {r.hintPods.join(", ")}</span>
                )}
              </div>
            )}
            {!compact && (
              <div className="gpuext-cell ellipsis gpuext-dim" title={r.node}>
                {r.node}
              </div>
            )}
            <div className="gpuext-cell">
              {r.gpus.length > 0 ? (
                r.gpus.map((g) => (
                  <span key={g} className="gpuext-badge gpuext-mono">
                    {g}
                  </span>
                ))
              ) : (
                <span className="gpuext-dim">({r.gpuCount})</span>
              )}
            </div>
            <div className="gpuext-cell">
              <UtilBar pct={r.gpuUtilPct} />
            </div>
            <div className="gpuext-cell num gpuext-mono">{fmtMiB(r.vramUsedMiB)}</div>
            <div className="gpuext-cell num gpuext-mono gpuext-dim">{fmtMiB(vramTotalMiB(r))}</div>
            <div className="gpuext-cell num gpuext-mono">{r.powerWatts.toFixed(0)} W</div>
          </div>
        );
      })}
    </div>
  );
}
