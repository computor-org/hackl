const assert = require("node:assert/strict");
const test = require("node:test");
const {
  detectMaxContextTokens,
  listModelIds,
  requiresNonLocalEndpointApproval,
  resolveEffectiveContextTokens,
  resolveChatTarget,
} = require("../dist/localServers.js");
const { normalizeOpenAIEndpoint } = require("../dist/openAIEndpoint.js");

test("normalizeOpenAIEndpoint makes /v1 optional for a bare server URL", () => {
  assert.equal(normalizeOpenAIEndpoint("http://localhost:8080"), "http://localhost:8080/v1");
  assert.equal(normalizeOpenAIEndpoint("http://localhost:8080/"), "http://localhost:8080/v1");
  assert.equal(normalizeOpenAIEndpoint("http://localhost:8080/v1/"), "http://localhost:8080/v1");
  assert.equal(normalizeOpenAIEndpoint("https://openrouter.ai/api/v1"), "https://openrouter.ai/api/v1");
});

test("resolveChatTarget accepts a bare llama.cpp server URL", async () => {
  const calls = [];
  const target = await resolveChatTarget({
    endpoint: "http://localhost:9999",
    endpointConfigured: true,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return modelResponse("loaded-model");
    },
  });

  assert.equal(calls[0], "http://localhost:9999/v1/models");
  assert.deepEqual(target, {
    endpoint: "http://localhost:9999/v1",
    model: "loaded-model",
  });
});

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
    endpoint: "http://gateway.example/v1",
    endpointConfigured: true,
    fetchImpl: async () => new Response(
      "Multiple models are registered; specify the model (available: qwen, qwen122b, qwen27b).",
      { status: 400 },
    ),
  });

  assert.deepEqual(target, {
    endpoint: "http://gateway.example/v1",
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
  assert.equal(requiresNonLocalEndpointApproval("http://gateway.example/v1"), true);
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

test("detectMaxContextTokens prefers LM Studio's loaded context for the selected model", async () => {
  const calls = [];
  const detected = await detectMaxContextTokens("http://localhost:1234/v1", async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/props")) return new Response("not found", { status: 404 });
    if (String(url) === "http://localhost:1234/api/v0/models") {
      return new Response(JSON.stringify({ data: [
        { id: "other", loaded_context_length: 16384, max_context_length: 262144 },
        { id: "qwen", loaded_context_length: 70912, max_context_length: 262144 },
      ] }));
    }
    throw new Error(`unexpected probe: ${url}`);
  }, "qwen");

  assert.equal(detected, 70912);
  assert.equal(calls.at(-1), "http://localhost:1234/api/v0/models");
});

test("resolveEffectiveContextTokens ignores a fallback override when the server reports one", async () => {
  const resolved = await resolveEffectiveContextTokens(
    "http://localhost:1234/v1",
    131072,
    async (url) => {
      if (String(url).endsWith("/props")) return new Response("not found", { status: 404 });
      if (String(url) === "http://localhost:1234/api/v0/models") {
        return new Response(JSON.stringify({ data: [{
          id: "qwen", loaded_context_length: 70912, max_context_length: 262144,
        }] }));
      }
      throw new Error(`unexpected probe: ${url}`);
    },
    "qwen",
  );

  assert.equal(resolved, 70912);
});

test("resolveChatTarget honors an explicit chat model over the endpoint's first model", async () => {
  let probed = false;
  const target = await resolveChatTarget({
    endpoint: "https://gateway.example/v1",
    endpointConfigured: true,
    preferredModel: "qwen-selected",
    fetchImpl: async () => {
      probed = true;
      return modelResponse("qwen-first");
    },
  });

  assert.deepEqual(target, {
    endpoint: "https://gateway.example/v1",
    model: "qwen-selected",
  });
  assert.equal(probed, false);
});

test("listModelIds returns every model the endpoint advertises", async () => {
  const ids = await listModelIds("https://gateway.example/v1/", async (url) => {
    assert.equal(String(url), "https://gateway.example/v1/models");
    return new Response(
      JSON.stringify({
        data: [
          { id: "qwen-small" },
          { id: "qwen-medium" },
          { id: "qwen-large" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  assert.deepEqual(ids, [
    "qwen-small",
    "qwen-medium",
    "qwen-large",
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
