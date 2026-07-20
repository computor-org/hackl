const assert = require("node:assert/strict");
const test = require("node:test");
const { probeAll } = require("../dist/localServers.js");

function ok(model, nCtx) {
  return new Response(JSON.stringify({ data: [{ id: model, n_ctx_train: nCtx }] }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

test("probeAll marks every reachable candidate with model + ctx", async () => {
  const candidates = [
    { name: "llama.cpp", endpoint: "http://localhost:8080/v1" },
    { name: "LM Studio", endpoint: "http://localhost:1234/v1" },
  ];
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.startsWith("http://localhost:8080")) {
      if (u.endsWith("/models")) return ok("qwen-local", 32768);
      if (u.endsWith("/props")) return new Response(JSON.stringify({ n_ctx: 32768 }), { status: 200 });
    }
    throw new Error("unreachable");
  };
  const results = await probeAll(candidates, fetchImpl);
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].model, "qwen-local");
  assert.equal(results[0].ctx, 32768);
  assert.equal(results[1].ok, false);
});

test("probeAll returns ok:false with a latency for fully-offline candidates", async () => {
  const results = await probeAll(
    [{ name: "x", endpoint: "http://localhost:9999/v1" }],
    async () => { throw new Error("offline"); },
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.equal(typeof results[0].latencyMs, "number");
});

test("probeAll tolerates a probe that succeeds but lacks model or ctx", async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/models")) return new Response("{}", { status: 200 });
    throw new Error("no props");
  };
  const results = await probeAll([{ name: "x", endpoint: "http://localhost:8080/v1" }], fetchImpl);
  // Endpoint responded 200; probeAll reports it as reachable even though no
  // model id was advertised. UI can show "connected but no model loaded".
  assert.equal(results[0].ok, true);
  assert.equal(results[0].model, undefined);
});

test("probeAll treats llama.cpp health as connected when models are unavailable", async () => {
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith("/models")) return new Response("not found", { status: 404 });
    if (u === "http://localhost:8080/health") return new Response("ok", { status: 200 });
    return new Response("not found", { status: 404 });
  };
  const results = await probeAll([{ name: "llama.cpp", endpoint: "http://localhost:8080/v1" }], fetchImpl);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].endpoint, "http://localhost:8080/v1");
  assert.equal(results[0].model, undefined);
});
