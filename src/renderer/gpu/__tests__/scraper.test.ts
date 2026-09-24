import { describe, expect, it, vi } from "vitest";

// The scraper imports the Freelens API for its default deps; tests inject their own, so stub the module.
vi.mock("@freelensapp/extensions", () => ({ Common: { logger: { info() {}, warn() {} } }, Renderer: {} }));

const { GpuScraper } = await import("../scraper");

type FakePod = {
  ns: string;
  name: string;
  phase: string;
  node?: string;
  limits?: Record<string, string>;
  scheduled?: { status: string; reason?: string; message?: string };
};

const pod = (p: FakePod) => ({
  getNs: () => p.ns,
  getName: () => p.name,
  getStatusPhase: () => p.phase,
  getNodeName: () => p.node,
  getContainers: () => [{ name: "c", image: "app:1", resources: { limits: p.limits ?? {} } }],
  metadata: { labels: {}, annotations: {}, creationTimestamp: "2026-09-24T10:00:00Z" },
  status: { conditions: p.scheduled ? [{ type: "PodScheduled", ...p.scheduled }] : [] },
});

describe("GpuScraper pod state", () => {
  it("keeps pending pods and requests even when no exporter exists (snapshot throws)", async () => {
    const pods = [
      pod({ ns: "ml", name: "run", phase: "Running", node: "n1", limits: { "nvidia.com/mig-1g.10gb": "1" } }),
      // bound but still pulling images: already holds its slice
      pod({
        ns: "ml",
        name: "starting",
        phase: "Pending",
        node: "n1",
        limits: { "nvidia.com/mig-1g.10gb": "1" },
        scheduled: { status: "True" },
      }),
      pod({
        ns: "queue",
        name: "waiting",
        phase: "Pending",
        limits: { "nvidia.com/gpu": "1" },
        scheduled: { status: "False", reason: "Unschedulable", message: "0/1 nodes are available" },
      }),
      pod({ ns: "web", name: "cpu", phase: "Running", node: "n1" }),
    ];
    const s = new GpuScraper({
      clusterId: () => "c1",
      listPods: async () => pods as never,
      fetchText: async () => "",
    });
    await expect(s.snapshot()).rejects.toThrow(/No GPU metrics exporter found/);

    const ps = s.podState;
    expect(ps?.pending).toEqual([
      expect.objectContaining({
        namespace: "queue",
        pod: "waiting",
        requests: { "nvidia.com/gpu": 1 },
        reason: "Unschedulable",
      }),
    ]);
    expect(ps?.requestedByNode.n1).toMatchObject({ gpus: 2, byResource: { "nvidia.com/mig-1g.10gb": 2 } });
    expect(ps?.requestedByNamespace.ml.pods).toEqual(["ml/run", "ml/starting"]);
    expect(ps?.requestedByNamespace.web).toBeUndefined();
  });
});
