const assert = require("node:assert/strict");
const test = require("node:test");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../dist/index.js");

const LINUX_GPU = { platform: "linux", arch: "x64", cpuCount: 16, totalRamGB: 64, freeRamGB: 40, accelerator: "cuda", vramGB: 24 };

test("parseNvidiaSmi extracts name and VRAM", () => {
  const p = core.parseNvidiaSmi("NVIDIA GeForce RTX 4090, 24576\n");
  assert.equal(p.name, "NVIDIA GeForce RTX 4090");
  assert.equal(p.vramGB, 24);
});

test("memoryBudgetGB: GPU = max(vram, half RAM); CPU leaves headroom", () => {
  assert.equal(core.memoryBudgetGB({ accelerator: "cuda", totalRamGB: 64, vramGB: 24 }), 32);
  assert.equal(core.memoryBudgetGB({ accelerator: "cpu", totalRamGB: 16 }), 13);
});

test("recommend: a ~16 GB machine prefers Qwen 9B over Gemma 12B", () => {
  assert.equal(core.recommendModel({ accelerator: "cpu", totalRamGB: 16 }).primary.alias, "qwen3.5-9b-q4");
});

test("recommend: a small machine picks a small coder model", () => {
  assert.equal(core.recommendModel({ accelerator: "cpu", totalRamGB: 8 }).primary.alias, "qwen2.5-coder-3b-q4");
});

test("recommend: a big machine picks Qwen3.8 27B", () => {
  assert.equal(core.recommendModel({ accelerator: "cuda", totalRamGB: 64, vramGB: 24 }).primary.alias, "qwen3.8-27b-q4");
});

test("resolveKnobs: linux MoE gets CPU-MoE split, q8 KV, loopback, MTP, thread cap", () => {
  const model = { ...core.findModel("qwen3.8-27b-q4"), alias: "qwen3.8-27b-mtp-test", kind: "moe", mtp: true };
  const knobs = core.resolveKnobs(LINUX_GPU, model, core.DEFAULT_ENGINE_CONFIG);
  assert.equal(knobs.host, "127.0.0.1");
  assert.equal(knobs.nCpuMoe, 35);
  assert.equal(knobs.cacheTypeK, "q8_0");
  assert.equal(knobs.mtp, true);
  assert.equal(knobs.threads, 14);
});

test("resolveKnobs: mtp 'off' disables spec decode even for an MTP model", () => {
  const cfg = { ...core.DEFAULT_ENGINE_CONFIG, mtp: "off" };
  const model = { ...core.findModel("qwen3.8-27b-q4"), alias: "qwen3.8-27b-mtp-test", kind: "moe", mtp: true };
  assert.equal(core.resolveKnobs(LINUX_GPU, model, cfg).mtp, false);
});

test("resolveKnobs: mac has no CPU-MoE split and no thread pinning", () => {
  const mac = { platform: "darwin", arch: "arm64", cpuCount: 10, totalRamGB: 32, freeRamGB: 20, accelerator: "metal", vramGB: 32 };
  const knobs = core.resolveKnobs(mac, core.findModel("qwen3.8-27b-q4"), core.DEFAULT_ENGINE_CONFIG);
  assert.equal(knobs.nCpuMoe, 0);
  assert.equal(knobs.threads, undefined);
  assert.equal(knobs.ubatch, undefined);
});

test("composeServerArgs: loopback, flash-attn, sampler, mmproj, n-cpu-moe, mtp", () => {
  const model = { ...core.findModel("qwen3.8-27b-q4"), alias: "qwen3.8-27b-mtp-test", kind: "moe", mtp: true };
  const knobs = core.resolveKnobs(LINUX_GPU, model, core.DEFAULT_ENGINE_CONFIG);
  const s = core.composeServerArgs("/m/model.gguf", "/m/mmproj.gguf", model, knobs).join(" ");
  assert.match(s, /--host 127\.0\.0\.1/);
  assert.match(s, /-fa on/);
  assert.match(s, /--reasoning-format deepseek/);
  assert.match(s, /--spec-type draft-mtp/);
  assert.match(s, /--mmproj \/m\/mmproj\.gguf --mmproj-offload/);
  assert.match(s, /--n-cpu-moe 35/);
});

test("detectServer adopts a reachable server and marks it external without state", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-state-"));
  const env = { ...process.env, XDG_STATE_HOME: dir, XDG_RUNTIME_DIR: "" };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes(":8080") && u.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "qwen" }] }), { headers: { "content-type": "application/json" } });
    }
    return new Response("no", { status: 503 });
  };
  const detected = await core.detectServer(env, fetchImpl);
  assert.ok(detected, "expected a detected server");
  assert.match(detected.endpoint, /:8080/);
  assert.equal(detected.managed, false);
});

test("removeModel deletes only the managed catalog cache and clears its preference", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-model-remove-"));
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: path.join(root, "config"),
    LLAMACPP_CACHE_ROOT: path.join(root, "models"),
  };
  const model = core.findModel("qwen2.5-coder-1.5b-q4");
  const dir = core.modelCacheDir(model, env);
  const outside = path.join(root, "keep.gguf");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "weights-q4_k_m.gguf"), "weights");
  fs.writeFileSync(outside, "user-owned");
  const engine = new core.EngineManager(env);
  engine.setConfig((config) => { config.model = model.alias; });

  assert.equal(engine.removeModel(model.alias), 7);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.readFileSync(outside, "utf8"), "user-owned");
  assert.equal(engine.config().model, undefined);
});
