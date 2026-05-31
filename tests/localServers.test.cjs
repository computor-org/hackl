const assert = require("node:assert/strict");
const test = require("node:test");
const {
  detectMaxContextTokens,
  listModelIds,
  requiresNonLocalEndpointApproval,
  resolveChatTarget,
} = require("../dist/localServers.js");

test("resolveChatTarget preserves explicit endpoint and uses loaded model", async () => {
  const target = await resolveChatTarget({
    endpoint: "http://localhost:9999/v1/",
    endpointConfigured: true,
    fetchImpl: async () => modelResponse("loaded-model"),
  });

  assert.deepEqual(target, {
    endpoint: "http://localhost:9999/v1",
    model: "loaded-model",
  });
});

test("resolveChatTarget discovers LM Studio after llama.cpp is unavailable", async () => {
  const calls = [];
  const target = await resolveChatTarget({
    endpointConfigured: false,
    candidates: [
      { name: "llama.cpp", endpoint: "http://localhost:8080/v1" },
      { name: "LM Studio", endpoint: "http://localhost:1234/v1" },
    ],
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).startsWith("http://localhost:8080")) {
        throw new Error("offline");
      }
      return modelResponse("lm-studio-model");
    },
  });

  assert.deepEqual(calls, [
    "http://localhost:8080/v1/models",
    "http://localhost:8080/health",
    "http://localhost:8080/v1/props",
    "http://localhost:8080/props",
    "http://localhost:1234/v1/models",
  ]);
  assert.deepEqual(target, {
    endpoint: "http://localhost:1234/v1",
    model: "lm-studio-model",
  });
});

test("resolveChatTarget falls back when discovery finds no server", async () => {
  const target = await resolveChatTarget({
    endpointConfigured: false,
    candidates: [
      { name: "llama.cpp", endpoint: "http://localhost:8080/v1" },
    ],
    fetchImpl: async () => new Response("not found", { status: 404 }),
  });

  assert.deepEqual(target, {
    endpoint: "http://localhost:8080/v1",
    model: "local-model",
  });
});

test("resolveChatTarget falls back to compatibility model for explicit endpoint without models", async () => {
  const target = await resolveChatTarget({
    endpoint: "http://localhost:7777/v1",
    endpointConfigured: true,
    fetchImpl: async () => new Response("not found", { status: 404 }),
  });

  assert.deepEqual(target, {
    endpoint: "http://localhost:7777/v1",
    model: "local-model",
  });
});

test("resolveChatTarget skips blank model ids from /v1/models", async () => {
  const target = await resolveChatTarget({
    endpoint: "http://localhost:7777/v1",
    endpointConfigured: true,
    fetchImpl: async () => new Response(JSON.stringify({
      data: [{ id: " " }, { id: "usable-model" }],
    })),
  });

  assert.deepEqual(target, {
    endpoint: "http://localhost:7777/v1",
    model: "usable-model",
  });
});

test("resolveChatTarget reads Ollama-style OpenAI-compatible model lists", async () => {
  const target = await resolveChatTarget({
    endpoint: "http://localhost:8080/v1",
    endpointConfigured: true,
    fetchImpl: async () => new Response(JSON.stringify({
      models: [{ name: "qwen", model: "qwen" }],
    })),
  });

  assert.deepEqual(target, {
    endpoint: "http://localhost:8080/v1",
    model: "qwen",
  });
});

test("resolveChatTarget uses first advertised model when server requires a model", async () => {
  const target = await resolveChatTarget({
    endpoint: "http://slopgate.example/v1",
    endpointConfigured: true,
    fetchImpl: async () => new Response(
      "Multiple models are registered; specify the model (available: qwen, qwen122b, qwen27b).",
      { status: 400 },
    ),
  });

  assert.deepEqual(target, {
    endpoint: "http://slopgate.example/v1",
    model: "qwen",
  });
});

test("resolveChatTarget accepts llama.cpp health when model listing is unavailable", async () => {
  const calls = [];
  const target = await resolveChatTarget({
    endpoint: "http://localhost:8080/v1",
    endpointConfigured: true,
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/models")) return new Response("not found", { status: 404 });
      if (String(url) === "http://localhost:8080/health") return new Response("ok", { status: 200 });
      throw new Error("unexpected");
    },
  });

  assert.deepEqual(target, {
    endpoint: "http://localhost:8080/v1",
    model: "local-model",
  });
  assert.deepEqual(calls, [
    "http://localhost:8080/v1/models",
    "http://localhost:8080/health",
  ]);
});

test("requiresNonLocalEndpointApproval only flags configured non-loopback endpoints", () => {
  assert.equal(requiresNonLocalEndpointApproval("http://slopgate.example/v1"), true);
  assert.equal(requiresNonLocalEndpointApproval("https://192.168.1.5/v1"), true);
  assert.equal(requiresNonLocalEndpointApproval("http://localhost:1234/v1"), false);
  assert.equal(requiresNonLocalEndpointApproval("http://127.0.0.1:8080/v1"), false);
  assert.equal(requiresNonLocalEndpointApproval("http://[::1]:8080/v1"), false);
  assert.equal(requiresNonLocalEndpointApproval(""), false);
});

test("detectMaxContextTokens reads llama.cpp root props with nested params", async () => {
  const calls = [];
  const detected = await detectMaxContextTokens("http://localhost:8080/v1", async (url) => {
    calls.push(String(url));
    if (String(url) === "http://localhost:8080/v1/props") {
      return new Response("not found", { status: 404 });
    }
    if (String(url) === "http://localhost:8080/props") {
      return new Response(JSON.stringify({
        default_generation_settings: {
          params: { n_ctx: 262144 },
        },
      }));
    }
    return new Response("not found", { status: 404 });
  });

  assert.equal(detected, 262144);
  assert.deepEqual(calls, [
    "http://localhost:8080/v1/props",
    "http://localhost:8080/props",
  ]);
});

test("detectMaxContextTokens falls back to model metadata context", async () => {
  const detected = await detectMaxContextTokens("http://localhost:8080/v1", async (url) => {
    if (String(url).endsWith("/props")) {
      return new Response("not found", { status: 404 });
    }
    if (String(url) === "http://localhost:8080/v1/models") {
      return new Response(JSON.stringify({
        data: [{ id: "qwen", meta: { n_ctx_train: 262144 } }],
      }));
    }
    return new Response("not found", { status: 404 });
  });

  assert.equal(detected, 262144);
});

test("resolveChatTarget honors an explicit chat model over the endpoint's first model", async () => {
  let probed = false;
  const target = await resolveChatTarget({
    endpoint: "http://10.77.0.20:8080/v1",
    endpointConfigured: true,
    preferredModel: "unsloth/qwen3.6:35b-a3b@128k",
    fetchImpl: async () => {
      probed = true;
      return modelResponse("qwen/qwen3-coder-next:80b-a3b-q4km@32k");
    },
  });

  assert.deepEqual(target, {
    endpoint: "http://10.77.0.20:8080/v1",
    model: "unsloth/qwen3.6:35b-a3b@128k",
  });
  assert.equal(probed, false);
});

test("listModelIds returns every model the endpoint advertises", async () => {
  const ids = await listModelIds("http://10.77.0.20:8080/v1/", async (url) => {
    assert.equal(String(url), "http://10.77.0.20:8080/v1/models");
    return new Response(
      JSON.stringify({
        data: [
          { id: "qwen/qwen3-coder-next:80b-a3b-q4km@32k" },
          { id: "unsloth/qwen3.5:122b-a10b@128k" },
          { id: "unsloth/qwen3.6:35b-a3b@128k" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  assert.deepEqual(ids, [
    "qwen/qwen3-coder-next:80b-a3b-q4km@32k",
    "unsloth/qwen3.5:122b-a10b@128k",
    "unsloth/qwen3.6:35b-a3b@128k",
  ]);
});

test("listModelIds returns an empty list when the endpoint is unreachable", async () => {
  const ids = await listModelIds("http://localhost:9/v1", async () => {
    throw new Error("offline");
  });
  assert.deepEqual(ids, []);
});

function modelResponse(id) {
  return new Response(JSON.stringify({ data: [{ id }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
