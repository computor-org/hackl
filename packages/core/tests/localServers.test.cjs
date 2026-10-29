const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const {
  detectMaxContextTokens,
  listModelIds,
  probeAll,
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

test("resolveChatTarget rejects when a configured endpoint lists no model", async () => {
  await assert.rejects(
    resolveChatTarget({
      endpoint: "http://localhost:7777/v1",
      endpointConfigured: true,
      fetchImpl: async () => new Response("not found", { status: 404 }),
    }),
    (error) => {
      const message = error.message;
      assert.match(message, /No model found at http:\/\/localhost:7777\/v1/);
      assert.match(message, /hackl\.model/);
      assert.match(message, /--model/);
      assert.match(message, /HACKL_MODEL/);
      return true;
    },
  );
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

test("resolveChatTarget rejects a reachable endpoint that lists no model", async () => {
  // A gateway can answer /health without a key and /models only with one, so
  // health alone must not guess a model name that the gateway rejects.
  await assert.rejects(
    resolveChatTarget({
      endpoint: "http://localhost:8080/v1",
      endpointConfigured: true,
      fetchImpl: async (url) => {
        if (String(url).endsWith("/models")) return new Response("unauthorized", { status: 401 });
        if (String(url) === "http://localhost:8080/health") return new Response("ok", { status: 200 });
        throw new Error("unexpected");
      },
    }),
    /No model found at http:\/\/localhost:8080\/v1/,
  );
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

// Stub of a key-protected OpenAI-compatible endpoint: /models and
// /chat/completions answer 401 without the bearer token, /health answers freely
// the way a gateway in front of llama.cpp does.
async function withAuthStub(handler) {
  const server = http.createServer((request, response) => {
    const authed = request.headers.authorization === "Bearer stub-key";
    if (request.url === "/health") {
      response.writeHead(200);
      response.end("ok");
      return;
    }
    if (request.url === "/v1/models") {
      if (!authed) {
        response.writeHead(401);
        response.end("unauthorized");
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "gateway-model" }] }));
      return;
    }
    if (request.url === "/v1/chat/completions") {
      if (!authed) {
        response.writeHead(401);
        response.end(JSON.stringify({ error: { code: "unknown_model" } }));
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        choices: [{ message: { content: "stub answer" } }],
        model: "gateway-model",
      }));
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    return await handler(endpoint);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("resolveChatTarget authenticates the model probe of a configured endpoint", async () => {
  await withAuthStub(async (endpoint) => {
    const target = await resolveChatTarget({
      endpoint,
      endpointConfigured: true,
      apiKey: "stub-key",
    });

    assert.deepEqual(target, { endpoint, model: "gateway-model" });
  });
});

test("resolveChatTarget reports no model instead of a guessed one when the key is missing", async () => {
  await withAuthStub(async (endpoint) => {
    await assert.rejects(
      resolveChatTarget({ endpoint, endpointConfigured: true }),
      new RegExp(`No model found at ${endpoint.replace(/\./g, "\\.")}`),
    );
  });
});

test("listModelIds authenticates the model listing", async () => {
  await withAuthStub(async (endpoint) => {
    assert.deepEqual(await listModelIds(endpoint, fetch, "stub-key"), ["gateway-model"]);
    assert.deepEqual(await listModelIds(endpoint, fetch), []);
  });
});

test("probeAll authenticates the configured endpoint", async () => {
  await withAuthStub(async (endpoint) => {
    const [withKey] = await probeAll([{ name: "configured", endpoint }], fetch, "stub-key");
    assert.equal(withKey.ok, true);
    assert.equal(withKey.model, "gateway-model");
  });
});

function modelResponse(id) {
  return new Response(JSON.stringify({ data: [{ id }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
