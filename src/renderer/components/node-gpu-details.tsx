import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { gpuStore } from "../gpu/store";
import { GpuTable } from "./gpu-table";
import { fmtMiB, gpuStyles } from "./styles";

const { DrawerTitle } = Renderer.Component;

type Props = Renderer.Component.KubeObjectDetailsProps<Renderer.K8sApi.Node>;

/** "GPU" section in the Node details drawer: every GPU row on that node. */
export const NodeGpuDetails = observer(({ object: node }: Props) => {
  React.useEffect(() => gpuStore.subscribe(), []);
  const rows = gpuStore.rowsForNode(node.getName());
  const devs = gpuStore.devicesForNode(node.getName());
  if (rows.length === 0 && devs.length === 0) return null;
  return (
    <div className="gpuext-details">
      <style>{gpuStyles}</style>
      <DrawerTitle>GPU</DrawerTitle>
      {devs.length > 0 && (
        <div className="gpuext-hint">
          {devs.length} device{devs.length === 1 ? "" : "s"}
          {devs[0].model ? ` · ${devs[0].model}` : ""} · {fmtMiB(devs.reduce((s, d) => s + d.vramUsedMiB, 0))} /{" "}
          {fmtMiB(devs.reduce((s, d) => s + d.vramTotalMiB, 0))} VRAM ·{" "}
          {devs.reduce((s, d) => s + d.powerWatts, 0).toFixed(0)} W
          {devs.some((d) => d.tempC !== undefined)
            ? ` · max ${Math.max(...devs.map((d) => d.tempC ?? 0)).toFixed(0)} °C`
            : ""}
        </div>
      )}
      {rows.length > 0 && <GpuTable rows={rows.map((r) => ({ ...r, node: "" }))} />}
      {gpuStore.snapshot && (
        <div className="gpuext-hint">last scrape {gpuStore.snapshot.scrapedAt.toLocaleTimeString()}</div>
      )}
    </div>
  );
});
