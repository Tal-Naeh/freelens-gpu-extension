import React from "react";
import { gpuSortKey, physicalGPUGroup } from "../gpu/aggregate";
import { isFallback, type PodGPU, vramTotalMiB } from "../gpu/types";
import { fmtMiB } from "./styles";
import { UtilBar } from "./util-bar";

export interface GpuTableProps {
  rows: PodGPU[];
  /** Hide the namespace/pod/node columns when the context already implies them. */
  compact?: boolean;
}

type ColKey = "namespace" | "pod" | "node" | "gpu" | "util" | "vramUsed" | "vramTotal" | "power";

interface Col {
  key: ColKey;
  title: string;
  width: number; // default px
  min: number;
  num?: boolean;
  /** Sort accessor. Strings compare lexically, numbers numerically. */
  value: (r: PodGPU) => string | number;
}

const ALL_COLS: Col[] = [
  { key: "namespace", title: "Namespace", width: 130, min: 60, value: (r) => r.namespace },
  { key: "pod", title: "Pod", width: 360, min: 80, value: (r) => r.pod },
  { key: "node", title: "Node", width: 200, min: 60, value: (r) => r.node },
  { key: "gpu", title: "GPU", width: 90, min: 50, value: (r) => gpuSortKey(r) },
  { key: "util", title: "GPU %", width: 175, min: 90, value: (r) => r.gpuUtilPct },
  { key: "vramUsed", title: "VRAM used", width: 100, min: 60, num: true, value: (r) => r.vramUsedMiB },
  { key: "vramTotal", title: "VRAM total", width: 100, min: 60, num: true, value: (r) => vramTotalMiB(r) },
  { key: "power", title: "Power", width: 80, min: 50, num: true, value: (r) => r.powerWatts },
];

const COMPACT_HIDDEN = new Set<ColKey>(["namespace", "pod", "node"]);

interface SortState {
  key: ColKey;
  dir: "asc" | "desc";
}

const DEFAULT_SORT: SortState = { key: "gpu", dir: "asc" };

function compare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function sortBy(rows: PodGPU[], cols: Col[], sort: SortState): PodGPU[] {
  const col = cols.find((c) => c.key === sort.key);
  if (!col) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  // rows arrive pre-sorted by GPU/VRAM/name (store.rows); a stable sort on
  // the chosen column keeps that as the tiebreak.
  return [...rows].sort((a, b) => sign * compare(col.value(a), col.value(b)));
}

function storageKey(mode: string) {
  return `freelens-gpu-extension.colwidths.${mode}`;
}

function loadWidths(mode: string, cols: Col[]): number[] {
  try {
    const raw = localStorage.getItem(storageKey(mode));
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr) && arr.length === cols.length && arr.every((n) => typeof n === "number")) return arr;
    }
  } catch {
    /* ignore */
  }
  return cols.map((c) => c.width);
}

/**
 * Rendered as a CSS grid rather than a <table>: the host app's table CSS
 * misaligned headers and cells, and a grid guarantees every column lines
 * up by construction. Headers sort on click; the handle at each header's
 * right edge resizes the column (double-click resets). Widths persist per
 * view in localStorage.
 */
export function GpuTable({ rows, compact }: GpuTableProps) {
  const mode = compact ? "compact" : "full";
  const cols = React.useMemo(() => ALL_COLS.filter((c) => !(compact && COMPACT_HIDDEN.has(c.key))), [compact]);
  const [sort, setSort] = React.useState<SortState>(DEFAULT_SORT);
  const [widths, setWidths] = React.useState<number[]>(() => loadWidths(mode, cols));
  const drag = React.useRef<{ idx: number; startX: number; startW: number } | null>(null);

  React.useEffect(() => {
    setWidths(loadWidths(mode, cols));
  }, [mode, cols]);

  const persist = (w: number[]) => {
    try {
      localStorage.setItem(storageKey(mode), JSON.stringify(w));
    } catch {
      /* ignore */
    }
  };

  const onHandleDown = (idx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { idx, startX: e.clientX, startW: widths[idx] };
    const onMove = (ev: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const next = [...widths];
      next[d.idx] = Math.max(cols[d.idx].min, d.startW + (ev.clientX - d.startX));
      setWidths(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      drag.current = null;
      setWidths((w) => {
        persist(w);
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const resetWidth = (idx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = [...widths];
    next[idx] = cols[idx].width;
    setWidths(next);
    persist(next);
  };

  const toggleSort = (key: ColKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const sorted = React.useMemo(() => sortBy(rows, cols, sort), [rows, cols, sort]);
  const showGroupSeparators = sort.key === "gpu";
  const template = widths.map((w) => `${w}px`).join(" ");

  let prevGroup = "";
  return (
    <div className="gpuext-grid" role="table" style={{ gridTemplateColumns: template }}>
      <div className="gpuext-row gpuext-head" role="row">
        {cols.map((c, i) => (
          <div
            key={c.key}
            className={`gpuext-cell gpuext-th${c.num ? " num" : ""}${sort.key === c.key ? " sorted" : ""}`}
            role="columnheader"
            onClick={() => toggleSort(c.key)}
            title={`Sort by ${c.title}`}
          >
            <span className="gpuext-th-label">
              {c.title}
              {sort.key === c.key && <span className="gpuext-sort">{sort.dir === "asc" ? "▲" : "▼"}</span>}
            </span>
            <span
              className="gpuext-resize"
              onMouseDown={onHandleDown(i)}
              onDoubleClick={resetWidth(i)}
              title="Drag to resize · double-click to reset"
            />
          </div>
        ))}
      </div>
      {sorted.map((r) => {
        const group = physicalGPUGroup(r);
        const sep = showGroupSeparators && prevGroup !== "" && group !== prevGroup;
        prevGroup = group;
        const key = `${r.namespace}/${r.pod}/${r.gpus.join(",")}`;
        const hint = isFallback(r) && r.hintPods && r.hintPods.length > 0 ? r.hintPods.join(", ") : "";
        return (
          <div key={key} className={`gpuext-row${sep ? " gpuext-sep" : ""}`} role="row">
            {cols.map((c) => {
              switch (c.key) {
                case "namespace":
                  return (
                    <div key={c.key} className="gpuext-cell ellipsis" title={r.namespace}>
                      {r.namespace}
                    </div>
                  );
                case "pod":
                  return (
                    <div key={c.key} className="gpuext-cell ellipsis" title={hint ? `${r.pod} → ${hint}` : r.pod}>
                      {r.pod}
                      {hint && <span className="gpuext-dim"> → {hint}</span>}
                    </div>
                  );
                case "node":
                  return (
                    <div key={c.key} className="gpuext-cell ellipsis gpuext-dim" title={r.node}>
                      {r.node}
                    </div>
                  );
                case "gpu":
                  return (
                    <div key={c.key} className="gpuext-cell ellipsis">
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
                  );
                case "util":
                  return (
                    <div key={c.key} className="gpuext-cell">
                      <UtilBar pct={r.gpuUtilPct} />
                    </div>
                  );
                case "vramUsed":
                  return (
                    <div key={c.key} className="gpuext-cell num gpuext-mono">
                      {fmtMiB(r.vramUsedMiB)}
                    </div>
                  );
                case "vramTotal":
                  return (
                    <div key={c.key} className="gpuext-cell num gpuext-mono gpuext-dim">
                      {fmtMiB(vramTotalMiB(r))}
                    </div>
                  );
                case "power":
                  return (
                    <div key={c.key} className="gpuext-cell num gpuext-mono">
                      {r.powerWatts.toFixed(0)} W
                    </div>
                  );
              }
            })}
          </div>
        );
      })}
    </div>
  );
}
