import { Renderer } from "@freelensapp/extensions";
import { GpuIcon } from "./components/gpu-icon";
import { NodeGpuDetails } from "./components/node-gpu-details";
import { PodGpuDetails } from "./components/pod-gpu-details";
import { AllocationPage } from "./pages/allocation-page";
import { DevicesPage } from "./pages/devices-page";
import { ExportersPage } from "./pages/exporters-page";
import { PodsPage } from "./pages/pods-page";
import { WastePage } from "./pages/waste-page";

export default class GpuExtensionRenderer extends Renderer.LensExtension {
  clusterPages = [
    { id: "gpu-pods", components: { Page: () => <PodsPage extension={this} /> } },
    { id: "gpu-devices", components: { Page: () => <DevicesPage extension={this} /> } },
    { id: "gpu-idle", components: { Page: () => <WastePage extension={this} /> } },
    { id: "gpu-allocation", components: { Page: () => <AllocationPage extension={this} /> } },
    { id: "gpu-exporters", components: { Page: () => <ExportersPage extension={this} /> } },
  ];

  clusterPageMenus = [
    { id: "gpu", title: "GPU", components: { Icon: GpuIcon } },
    { id: "gpu-pods", parentId: "gpu", target: { pageId: "gpu-pods" }, title: "Pods", components: {} },
    { id: "gpu-devices", parentId: "gpu", target: { pageId: "gpu-devices" }, title: "GPUs", components: {} },
    { id: "gpu-idle", parentId: "gpu", target: { pageId: "gpu-idle" }, title: "Idle & waste", components: {} },
    { id: "gpu-allocation", parentId: "gpu", target: { pageId: "gpu-allocation" }, title: "Allocation", components: {} },
    { id: "gpu-exporters", parentId: "gpu", target: { pageId: "gpu-exporters" }, title: "Exporters", components: {} },
  ];

  kubeObjectDetailItems = [
    {
      kind: "Pod",
      apiVersions: ["v1"],
      priority: 5,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => <PodGpuDetails {...props} />,
      },
    },
    {
      kind: "Node",
      apiVersions: ["v1"],
      priority: 5,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => <NodeGpuDetails {...props} />,
      },
    },
  ];
}
