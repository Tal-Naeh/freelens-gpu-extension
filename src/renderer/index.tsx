import { Renderer } from "@freelensapp/extensions";
import { GpuIcon } from "./components/gpu-icon";
import { GpuPage } from "./components/gpu-page";
import { NodeGpuDetails } from "./components/node-gpu-details";
import { PodGpuDetails } from "./components/pod-gpu-details";

export default class GpuExtensionRenderer extends Renderer.LensExtension {
  clusterPages = [
    {
      id: "gpu",
      components: {
        Page: () => <GpuPage />,
      },
    },
  ];

  clusterPageMenus = [
    {
      id: "gpu-menu",
      target: { pageId: "gpu" },
      title: "GPU",
      components: {
        Icon: GpuIcon,
      },
    },
  ];

  kubeObjectDetailItems = [
    {
      kind: "Pod",
      apiVersions: ["v1"],
      priority: 5,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <PodGpuDetails {...props} />
        ),
      },
    },
    {
      kind: "Node",
      apiVersions: ["v1"],
      priority: 5,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <NodeGpuDetails {...props} />
        ),
      },
    },
  ];
}
