const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveChatTarget } = require("../dist/localServers.js");

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

function modelResponse(id) {
  return new Response(JSON.stringify({ data: [{ id }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
