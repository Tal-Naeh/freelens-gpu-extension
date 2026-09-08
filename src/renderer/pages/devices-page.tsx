import type { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { type Column, DataGrid } from "../components/data-grid";
import { PageShell } from "../components/page-shell";
import { fmtMiB } from "../components/styles";
import { UtilBar } from "../components/util-bar";
import { gpuStore } from "../gpu/store";
import type { GpuDevice } from "../gpu/types";

const gpuKey = (d: GpuDevice) =>
  `${d.node}/${d.gpu
    .split(":")
    .map((p) => p.padStart(3, "0"))
    .join(":")}`;

const tempClass = (t?: number) => (t === undefined ? "" : t >= 85 ? "gpuext-hot" : t >= 75 ? "gpuext-warn" : "");

export const DEVICE_COLUMNS: Column<GpuDevice>[] = [
  { key: "node", title: "Node", width: 220, min: 80, value: (d) => d.node },
  { key: "gpu", title: "GPU", width: 70, min: 50, value: (d) => gpuKey(d), title_: (d) => d.gpu, render: (d) => <span className="gpuext-badge gpuext-mono">{d.gpu}</span> },
  { key: "model", title: "Model", width: 200, min: 80, value: (d) => d.model ?? "", className: "gpuext-dim" },
  { key: "mig", title: "MIG profile", width: 100, min: 60, value: (d) => d.migProfile ?? "", className: "gpuext-mono" },
  { key: "util", title: "GPU %", width: 175, min: 90, value: (d) => d.utilPct, title_: (d) => `${d.utilPct.toFixed(1)}%`, render: (d) => <UtilBar pct={d.utilPct} /> },
  { key: "vramUsed", title: "VRAM used", width: 100, min: 60, num: true, value: (d) => d.vramUsedMiB, render: (d) => fmtMiB(d.vramUsedMiB) },
  { key: "vramTotal", title: "VRAM total", width: 100, min: 60, num: true, value: (d) => d.vramTotalMiB, render: (d) => fmtMiB(d.vramTotalMiB), className: "gpuext-dim" },
  {
    key: "vramPct",
    title: "VRAM %",
    width: 80,
    min: 60,
    num: true,
    value: (d) => (d.vramTotalMiB > 0 ? (100 * d.vramUsedMiB) / d.vramTotalMiB : 0),
    render: (d) => (d.vramTotalMiB > 0 ? `${((100 * d.vramUsedMiB) / d.vramTotalMiB).toFixed(0)}%` : "–"),
  },
  { key: "power", title: "Power", width: 80, min: 50, num: true, value: (d) => d.powerWatts, render: (d) => `${d.powerWatts.toFixed(0)} W` },
  { key: "temp", title: "Temp", width: 70, min: 50, num: true, value: (d) => d.tempC ?? -1, render: (d) => <span className={tempClass(d.tempC)}>{d.tempC === undefined ? "–" : `${d.tempC.toFixed(0)} °C`}</span> },
  { key: "pods", title: "Pods", width: 90, min: 50, num: true, value: (d) => d.pods.length, title_: (d) => d.pods.join("\n") },
  { key: "podlist", title: "Pod names", width: 360, min: 100, value: (d) => d.pods.join(", "), className: "gpuext-dim" },
];

export const DevicesPage = observer(({ extension }: { extension: Renderer.LensExtension }) => {
  const devs = gpuStore.devices;
  const idle = devs.filter((d) => d.pods.length === 0 && d.utilPct < 5).length;
  return (
    <PageShell
      extension={extension}
      title="GPUs"
      subtitle={
        devs.length > 0 && (
          <>
            {devs.length} device{devs.length === 1 ? "" : "s"} · {idle} with no pod and idle · total VRAM{" "}
            {fmtMiB(devs.reduce((s, d) => s + d.vramTotalMiB, 0))} · {devs.reduce((s, d) => s + d.powerWatts, 0).toFixed(0)} W
          </>
        )
      }
    >
      <DataGrid
        id="devices"
        columns={DEVICE_COLUMNS}
        rows={devs}
        rowKey={(d) => `${d.node}/${d.gpu}`}
        defaultSort={{ key: "gpu", dir: "asc" }}
        groupOf={(d) => d.node}
        emptyText="No per-device metrics in this snapshot."
      />
    </PageShell>
  );
});
