import { physicalGPUGroup } from "../gpu/aggregate";
import { isFallback, type PodGPU, vramTotalMiB } from "../gpu/types";
import { fmtMiB } from "./styles";
import { UtilBar } from "./util-bar";

export interface GpuTableProps {
  rows: PodGPU[];
  /** Hide the namespace/pod/node columns when the context already implies them. */
  compact?: boolean;
}

export function GpuTable({ rows, compact }: GpuTableProps) {
  let prevGroup = "";
  return (
    <table className="gpuext-table">
      <thead>
        <tr>
          {!compact && <th>Namespace</th>}
          {!compact && <th>Pod</th>}
          {!compact && <th>Node</th>}
          <th>GPU</th>
          <th>GPU %</th>
          <th className="num">VRAM used</th>
          <th className="num">VRAM total</th>
          <th className="num">Power</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const group = physicalGPUGroup(r);
          const sep = prevGroup !== "" && group !== prevGroup;
          prevGroup = group;
          const key = `${r.namespace}/${r.pod}/${r.gpus.join(",")}`;
          return (
            <tr key={key} className={sep ? "gpuext-sep" : undefined}>
              {!compact && <td>{r.namespace}</td>}
              {!compact && (
                <td>
                  {r.pod}
                  {isFallback(r) && r.hintPods && r.hintPods.length > 0 && (
                    <span className="gpuext-dim"> → {r.hintPods.join(", ")}</span>
                  )}
                </td>
              )}
              {!compact && <td className="gpuext-dim">{r.node}</td>}
              <td>
                {r.gpus.length > 0 ? (
                  r.gpus.map((g) => (
                    <span key={g} className="gpuext-badge gpuext-mono">
                      {g}
                    </span>
                  ))
                ) : (
                  <span className="gpuext-dim">({r.gpuCount})</span>
                )}
              </td>
              <td>
                <UtilBar pct={r.gpuUtilPct} />
              </td>
              <td className="num gpuext-mono">{fmtMiB(r.vramUsedMiB)}</td>
              <td className="num gpuext-mono gpuext-dim">{fmtMiB(vramTotalMiB(r))}</td>
              <td className="num gpuext-mono">{r.powerWatts.toFixed(0)} W</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
