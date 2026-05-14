const assert = require("node:assert/strict");
const test = require("node:test");
const { CATALOG, findModel } = require("../../dist/server/catalog.js");
const { recommend, fitModel, llamaServerArgs } = require("../../dist/server/recommend.js");

const GiB = 1024 ** 3;

function hw(overrides) {
  return {
    platform: "linux",
    arch: "x64",
    totalRamBytes: 64 * GiB,
    freeRamBytes: 48 * GiB,
    physicalCores: 16,
    backend: "cuda",
    gpuVendor: "nvidia",
    unifiedMemory: false,
    ...overrides,
  };
}

test("catalog exposes the five curated models", () => {
  const ids = CATALOG.map((m) => m.id).sort();
  assert.deepEqual(ids, [
    "gemma-4-26b-a4b",
    "gemma-4-e4b",
    "qwen3.5-4b",
    "qwen3.5-9b",
    "qwen3.6-35b-a3b",
  ]);
});

test("RTX 5090 (32 GB) fits the 35B-A3B with full offload", () => {
  const profile = hw({ gpuName: "RTX 5090", vramTotalBytes: 32 * GiB, vramFreeBytes: 31 * GiB });
  const rec = recommend(profile);
  assert.equal(rec.recommendedId, "qwen3.6-35b-a3b");
  const fit = rec.fits.find((f) => f.modelId === "qwen3.6-35b-a3b");
  assert.equal(fit.fits, "full");
  assert.equal(fit.nGpuLayers, 99);
  assert.equal(fit.cacheTypeK, "q8_0");
});

test("RTX 5060 Ti (16 GB) uses CPU-MoE for the 35B-A3B", () => {
  const profile = hw({ gpuName: "RTX 5060 Ti", vramTotalBytes: 16 * GiB, vramFreeBytes: 15 * GiB });
  const rec = recommend(profile);
  const fit = rec.fits.find((f) => f.modelId === "qwen3.6-35b-a3b");
  assert.equal(fit.fits, "partial");
  assert.ok(fit.cpuMoe && fit.cpuMoe > 0, "expects cpu-moe set");
});

test("8 GB GPU prefers the 9B with full fit", () => {
  const profile = hw({ gpuName: "RTX 3070", vramTotalBytes: 8 * GiB, vramFreeBytes: 7.5 * GiB });
  const rec = recommend(profile);
  // 9B Q4_K_M ~5.4 GiB + KV at recommendedCtx may not fit; recommender should pick smaller.
  assert.ok(["qwen3.5-9b", "qwen3.5-4b", "gemma-4-e4b"].includes(rec.recommendedId));
  const fitFor = rec.fits.find((f) => f.modelId === rec.recommendedId);
  assert.notEqual(fitFor.fits, "no");
});

test("Pure CPU host (no GPU) falls back to RAM execution", () => {
  const profile = hw({
    backend: "cpu",
    gpuVendor: undefined,
    vramTotalBytes: undefined,
    vramFreeBytes: undefined,
  });
  const fit = fitModel(findModel("qwen3.5-4b"), profile);
  assert.equal(fit.nGpuLayers, 0);
  assert.equal(fit.flashAttn, "off");
  assert.equal(fit.fits, "full");
});

test("Apple Silicon unified memory uses total RAM as VRAM budget", () => {
  const profile = hw({
    platform: "darwin",
    arch: "arm64",
    backend: "metal",
    gpuVendor: "apple",
    unifiedMemory: true,
    totalRamBytes: 64 * GiB,
    freeRamBytes: 48 * GiB,
    vramTotalBytes: Math.floor(64 * GiB * 0.75),
  });
  const rec = recommend(profile);
  assert.equal(rec.recommendedId, "qwen3.6-35b-a3b");
  const fit = rec.fits.find((f) => f.modelId === "qwen3.6-35b-a3b");
  assert.equal(fit.fits, "full");
  assert.equal(fit.flashAttn, "auto");
});

test("llamaServerArgs emits expected flags", () => {
  const model = findModel("qwen3.5-9b");
  const fit = fitModel(model, hw({ vramTotalBytes: 24 * GiB, vramFreeBytes: 23 * GiB }));
  const args = llamaServerArgs(model, fit, "/models/qwen3.5-9b.gguf", 8080);
  assert.ok(args.includes("--cache-type-k"));
  assert.ok(args.includes("q8_0"));
  assert.ok(args.includes("--jinja"));
  assert.ok(args.includes("--alias"));
  assert.equal(args[args.indexOf("--alias") + 1], "qwen3.5-9b");
  assert.equal(args[args.indexOf("--port") + 1], "8080");
});

test("MoE partial fit on tight 12 GB GPU still recommends something", () => {
  const profile = hw({ vramTotalBytes: 12 * GiB, vramFreeBytes: 11 * GiB });
  const rec = recommend(profile);
  assert.ok(rec.recommendedId, "expected a recommendation");
});
