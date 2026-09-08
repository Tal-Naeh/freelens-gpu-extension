import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { gpuStore } from "../gpu/store";
import { GpuTable } from "./gpu-table";
import { gpuStyles } from "./styles";

const { DrawerTitle } = Renderer.Component;

type Props = Renderer.Component.KubeObjectDetailsProps<Renderer.K8sApi.Node>;

/** "GPU" section in the Node details drawer: every GPU row on that node. */
export const NodeGpuDetails = observer(({ object: node }: Props) => {
  React.useEffect(() => gpuStore.subscribe(), []);
  const rows = gpuStore.rowsForNode(node.getName());
  if (rows.length === 0) return null;
  return (
    <div className="gpuext-details">
      <style>{gpuStyles}</style>
      <DrawerTitle>GPU</DrawerTitle>
      <GpuTable rows={rows.map((r) => ({ ...r, node: "" }))} />
      {gpuStore.snapshot && (
        <div className="gpuext-hint">last scrape {gpuStore.snapshot.scrapedAt.toLocaleTimeString()}</div>
      )}
    </div>
  );
});
