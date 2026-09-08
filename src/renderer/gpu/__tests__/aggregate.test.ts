import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateByGPU,
  aggregateByPod,
  aggregateDevicesDcgm,
  aggregateDevicesEnricher,
  buildEnricherRows,
  extractDcgmSamples,
  sortDevices,
  sortRows,
} from "../aggregate";
import { classifyMetrics, parsePrometheusText } from "../prom";

import type { PodGPU } from "../types";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const fams = (name: string) => parsePrometheusText(fixture(name));
const byPod = (rows: PodGPU[], ns: string, pod: string): PodGPU => {
  const r = rows.find((x) => x.namespace === ns && x.pod === pod);
  if (!r) throw new Error(`row ${ns}/${pod} missing in ${JSON.stringify(rows)}`);
  return r;
};

describe("prom parser", () => {
  it("parses labels, values and escapes", () => {
    const f = parsePrometheusText(
      'a_b{x="1",y="q\\"uote",z="back\\\\slash"} 12.5 1700000000\nplain 3\n# comment\n\nnan_v NaN\n',
    );
    expect(f.get("a_b")?.[0]).toEqual({ name: "a_b", labels: { x: "1", y: 'q"uote', z: "back\\slash" }, value: 12.5 });
    expect(f.get("plain")?.[0].value).toBe(3);
    expect(Number.isNaN(f.get("nan_v")?.[0].value)).toBe(true);
  });
  it("classifies exporters by metric content", () => {
    expect(classifyMetrics(fixture("dcgm_pod_labels.prom"))).toBe("dcgm");
    expect(classifyMetrics(fixture("dcgm_mig.prom"))).toBe("dcgm");
    expect(classifyMetrics(fixture("enricher.prom"))).toBe("enricher");
    expect(classifyMetrics("http_requests_total 1")).toBeUndefined();
  });
});

describe("dcgm pod attribution", () => {
  const rows = aggregateByPod(extractDcgmSamples(fams("dcgm_pod_labels.prom"), "exporter-node"));
  it("drops unattributed GPUs and aggregates multi-GPU pods", () => {
    expect(rows).toHaveLength(2);
    const vllm = byPod(rows, "ml", "vllm-0");
    expect(vllm.gpus).toEqual(["0", "1"]);
    expect(vllm.gpuCount).toBe(2);
    expect(vllm.gpuUtilPct).toBe(65);
    expect(vllm.vramUsedMiB).toBe(135000);
    expect(vllm.vramUsedMiB + vllm.vramFreeMiB).toBe(162000);
    expect(vllm.powerWatts).toBe(511);
    expect(vllm.node).toBe("node-a"); // Hostname label wins over exporter node
  });
  it("falls back to per-GPU rows for unattributed samples", () => {
    const un = extractDcgmSamples(fams("dcgm_pod_labels.prom"), "exporter-node").filter((s) => !s.pod);
    const fb = aggregateByGPU(un);
    expect(fb).toHaveLength(1);
    expect(fb[0]).toMatchObject({ namespace: "-", pod: "(gpu 3)", gpuIndex: "3", gpus: ["3"], powerWatts: 55 });
    expect(fb[0].vramUsedMiB + fb[0].vramFreeMiB).toBe(81000);
  });
});

describe("dcgm MIG", () => {
  const rows = aggregateByPod(extractDcgmSamples(fams("dcgm_mig.prom"), "dgx-1"));
  it("keys on gpu:GPU_I_ID and scales PROF_GR_ENGINE_ACTIVE to percent", () => {
    expect(rows).toHaveLength(4);
    const t0 = byPod(rows, "it-dgx1", "transcription-0");
    expect(t0.gpus).toEqual(["0:7"]);
    expect(t0.gpuUtilPct).toBeCloseTo(42);
    const ocr = byPod(rows, "it-dgx2", "ocr-0");
    expect(ocr.vramUsedMiB).toBe(9000);
    expect(ocr.vramUsedMiB + ocr.vramFreeMiB).toBe(9700);
  });
  it("sorts slices of the same card together, card 0 before card 1", () => {
    expect(sortRows(rows).map((r) => r.gpus[0])).toEqual(["0:7", "0:8", "0:9", "1:1"]);
  });
});

describe("per-process exporter", () => {
  const rows = buildEnricherRows([{ fams: fams("enricher.prom"), node: "gpu-node-1" }]);
  it("sums VRAM per pod, max util, proportional power", () => {
    expect(rows).toHaveLength(3);
    const vllm = byPod(rows, "ml", "vllm-0");
    expect(vllm.vramUsedMiB).toBe(50 * 1024);
    expect(vllm.gpuUtilPct).toBe(60);
    expect(vllm.powerWatts).toBeCloseTo(250);
    const tei1 = byPod(rows, "embeddings", "tei-1");
    expect(tei1.powerWatts).toBeCloseTo(100);
    expect(tei1.node).toBe("gpu-node-1");
    expect(byPod(rows, "embeddings", "tei-2").gpus).toEqual(["1"]);
  });
});

describe("per-device aggregation", () => {
  it("dcgm: one device per card with model, temp, totals and pod set", () => {
    const devs = sortDevices(aggregateDevicesDcgm(fams("dcgm_pod_labels.prom"), "exporter-node"));
    expect(devs.map((d) => d.gpu)).toEqual(["0", "1", "2", "3"]);
    const g0 = devs[0];
    expect(g0).toMatchObject({
      node: "node-a",
      uuid: "GPU-aaaa",
      model: "NVIDIA A100-SXM4-80GB",
      utilPct: 87,
      tempC: 71,
    });
    expect(g0.vramUsedMiB).toBe(70000);
    expect(g0.vramTotalMiB).toBe(81000);
    expect(g0.pods).toEqual(["ml/vllm-0"]);
    expect(devs[3].pods).toEqual([]); // unattributed card still listed
    expect(devs[3].powerWatts).toBe(55);
  });
  it("dcgm MIG: one device per slice with profile", () => {
    const devs = sortDevices(aggregateDevicesDcgm(fams("dcgm_mig.prom"), "dgx-1"));
    expect(devs.map((d) => d.gpu)).toEqual(["0:7", "0:8", "0:9", "1:1"]);
    expect(devs[0]).toMatchObject({
      migProfile: "1g.10gb",
      utilPct: 42,
      vramUsedMiB: 6000,
      vramTotalMiB: 9700,
      pods: ["it-dgx1/transcription-0"],
    });
  });
  it("enricher: totals per uuid, usage summed, pods collected", () => {
    const devs = sortDevices(aggregateDevicesEnricher([{ fams: fams("enricher.prom"), node: "gpu-node-1" }]));
    expect(devs).toHaveLength(2);
    const g0 = devs[0];
    expect(g0).toMatchObject({
      node: "gpu-node-1",
      gpu: "0",
      uuid: "GPU-aaaa",
      powerWatts: 400,
      vramTotalMiB: 80 * 1024,
    });
    expect(g0.vramUsedMiB).toBe(70 * 1024); // 40+10+20 GiB
    expect(g0.utilPct).toBe(60); // max process util (no device-level gauge in fixture)
    expect(g0.pods).toEqual(["embeddings/tei-1", "ml/vllm-0"]);
  });
});
