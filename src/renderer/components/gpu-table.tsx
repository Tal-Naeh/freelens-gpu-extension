import React from "react";
import { gpuSortKey, physicalGPUGroup } from "../gpu/aggregate";
import { isFallback, type PodGPU, vramTotalMiB } from "../gpu/types";
import { type Column, DataGrid } from "./data-grid";
import { fmtMiB } from "./styles";
import { UtilBar } from "./util-bar";

export interface GpuTableProps {
  rows: PodGPU[];
  /** Hide the namespace/pod/node columns when the context already implies them. */
  compact?: boolean;
}

const GpuBadges = ({ r }: { r: PodGPU }) =>
  r.gpus.length > 0 ? (
    <>
      {r.gpus.map((g) => (
        <span key={g} className="gpuext-badge gpuext-mono">
          {g}
        </span>
      ))}
    </>
  ) : (
    <span className="gpuext-dim">({r.gpuCount})</span>
  );

const hintOf = (r: PodGPU) => (isFallback(r) && r.hintPods && r.hintPods.length > 0 ? r.hintPods.join(", ") : "");

export const POD_COLUMNS: Column<PodGPU>[] = [
  { key: "namespace", title: "Namespace", width: 130, min: 60, value: (r) => r.namespace },
  {
    key: "pod",
    title: "Pod",
    width: 360,
    min: 80,
    value: (r) => r.pod,
    title_: (r) => (hintOf(r) ? `${r.pod} → ${hintOf(r)}` : r.pod),
    render: (r) => (
      <>
        {r.pod}
        {hintOf(r) && <span className="gpuext-dim"> → {hintOf(r)}</span>}
      </>
    ),
  },
  { key: "node", title: "Node", width: 200, min: 60, value: (r) => r.node, className: "gpuext-dim" },
  {
    key: "gpu",
    title: "GPU",
    width: 90,
    min: 50,
    value: (r) => gpuSortKey(r),
    title_: (r) => r.gpus.join(", "),
    render: (r) => <GpuBadges r={r} />,
  },
  {
    key: "util",
    title: "GPU %",
    width: 175,
    min: 90,
    value: (r) => r.gpuUtilPct,
    title_: (r) => `${r.gpuUtilPct.toFixed(1)}%`,
    render: (r) => <UtilBar pct={r.gpuUtilPct} />,
  },
  {
    key: "vramUsed",
    title: "VRAM used",
    width: 100,
    min: 60,
    num: true,
    value: (r) => r.vramUsedMiB,
    render: (r) => fmtMiB(r.vramUsedMiB),
  },
  {
    key: "vramTotal",
    title: "VRAM total",
    width: 100,
    min: 60,
    num: true,
    value: (r) => vramTotalMiB(r),
    render: (r) => fmtMiB(vramTotalMiB(r)),
    className: "gpuext-dim",
  },
  {
    key: "power",
    title: "Power",
    width: 80,
    min: 50,
    num: true,
    value: (r) => r.powerWatts,
    render: (r) => `${r.powerWatts.toFixed(0)} W`,
  },
];

const COMPACT_HIDDEN = new Set(["namespace", "pod", "node"]);

export function GpuTable({ rows, compact }: GpuTableProps) {
  const columns = React.useMemo(
    () => (compact ? POD_COLUMNS.filter((c) => !COMPACT_HIDDEN.has(c.key)) : POD_COLUMNS),
    [compact],
  );
  return (
    <DataGrid
      id={compact ? "pods.compact" : "pods.full"}
      columns={columns}
      rows={rows}
      rowKey={(r) => `${r.namespace}/${r.pod}/${r.gpus.join(",")}`}
      defaultSort={{ key: "gpu", dir: "asc" }}
      groupOf={physicalGPUGroup}
    />
  );
}
