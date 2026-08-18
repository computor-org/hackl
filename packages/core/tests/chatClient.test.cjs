const assert = require("node:assert/strict");
const test = require("node:test");
const { createOpenAICompatibleBackend, sendChat } = require("../dist/chatClient.js");

const messages = [{ role: "user", content: "ping" }];

test("sendChat posts an OpenAI-compatible chat completion request", async () => {
  let request;
  const answer = await sendChat(messages, {
    endpoint: "http://localhost:1234/v1/",
    model: "loaded-model",
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return jsonResponse({ choices: [{ message: { content: "pong" } }] });
    },
  });

  assert.equal(answer, "pong");
  assert.equal(request.url, "http://localhost:1234/v1/chat/completions");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), {
    model: "loaded-model",
    messages,
    stream: false,
    temperature: 0.2,
  });
});

test("sendChat accepts a bare llama.cpp server URL", async () => {
  let requestUrl;
  await sendChat(messages, {
    endpoint: "http://localhost:8080",
    model: "qwen",
    fetchImpl: async (url) => {
      requestUrl = String(url);
      return jsonResponse({ choices: [{ message: { content: "pong" } }] });
    },
  });
  assert.equal(requestUrl, "http://localhost:8080/v1/chat/completions");
});

test("sendChat sends a Bearer Authorization header when an apiKey is set", async () => {
  let request;
  await sendChat(messages, {
    endpoint: "https://openrouter.ai/api/v1",
    model: "qwen/qwen3-coder:free",
    apiKey: "sk-or-secret",
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return jsonResponse({ choices: [{ message: { content: "pong" } }] });
    },
  });

  assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(request.init.headers.Authorization, "Bearer sk-or-secret");
  assert.equal(request.init.headers["Content-Type"], "application/json");
});

test("sendChat omits Authorization for keyless local servers", async () => {
  let request;
  await sendChat(messages, {
    endpoint: "http://localhost:1234/v1",
    model: "loaded-model",
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return jsonResponse({ choices: [{ message: { content: "pong" } }] });
    },
  });

  assert.equal("Authorization" in request.init.headers, false);
});

test("sendChat can request non-thinking Qwen-compatible chat templates", async () => {
  let request;
  await sendChat(messages, {
    endpoint: "http://localhost:1234/v1/",
    model: "loaded-model",
    enableThinking: false,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return jsonResponse({ choices: [{ message: { content: "pong" } }] });
    },
  });

  assert.deepEqual(JSON.parse(request.init.body), {
    model: "loaded-model",
    messages,
    stream: false,
    temperature: 0.2,
    chat_template_kwargs: { enable_thinking: false },
    enable_thinking: false,
  });
});


test("sendChat caps reasoning with thinking_budget_tokens when thinking is allowed", async () => {
  let request;
  await sendChat(messages, {
    endpoint: "http://localhost:1234/v1/",
    model: "loaded-model",
    reasoningBudget: 4096,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return jsonResponse({ choices: [{ message: { content: "pong" } }] });
    },
  });

  assert.deepEqual(JSON.parse(request.init.body), {
    model: "loaded-model",
    messages,
    stream: false,
    temperature: 0.2,
    thinking_budget_tokens: 4096,
  });
});

test("sendChat omits the reasoning budget when thinking is disabled", async () => {
  let request;
  await sendChat(messages, {
    endpoint: "http://localhost:1234/v1/",
    model: "loaded-model",
    enableThinking: false,
    reasoningBudget: 4096,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return jsonResponse({ choices: [{ message: { content: "pong" } }] });
    },
  });

  const body = JSON.parse(request.init.body);
  assert.equal(body.enable_thinking, false);
  assert.equal("thinking_budget_tokens" in body, false);
});

test("backend accepts a bounded non-thinking compaction request", async () => {
  let request;
  const backend = createOpenAICompatibleBackend({
    endpoint: "http://localhost:1234/v1",
    model: "loaded-model",
    reasoningBudget: 4096,
    fetchImpl: async (_url, init) => {
      request = JSON.parse(init.body);
      return jsonResponse({ choices: [{ message: { content: "checkpoint" } }] });
    },
  });

  await backend.complete(messages, { maxOutputTokens: 4096, enableThinking: false });
  assert.equal(request.max_tokens, 4096);
  assert.equal(request.enable_thinking, false);
  assert.equal("thinking_budget_tokens" in request, false);
});

test("OpenAI-compatible backend returns response model metadata", async () => {
  const backend = createOpenAICompatibleBackend({
    endpoint: "http://localhost:8080/v1",
    model: "request-model",
    fetchImpl: async () => jsonResponse({
      model: "response-model",
      choices: [{ message: { content: "ok" } }],
    }),
  });

  assert.deepEqual(await backend.complete(messages), {
    content: "ok",
    model: "response-model",
  });
});

test("OpenAI-compatible backend streams answer and reasoning deltas", async () => {
  const deltas = [];
  let request;
  const backend = createOpenAICompatibleBackend({
    endpoint: "http://localhost:8080/v1",
    model: "request-model",
    fetchImpl: async (_url, init) => {
      request = init;
      return new Response([
        'data: {"model":"response-model","choices":[{"delta":{"reasoning_content":"plan"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        "data: [DONE]\n\n",
      ].join(""), { headers: { "content-type": "text/event-stream" } });
    },
  });

  assert.deepEqual(await backend.complete(messages, { onDelta: (delta) => deltas.push(delta) }), {
    content: "ok",
    reasoning: "plan",
    model: "response-model",
  });
  assert.equal(JSON.parse(request.body).stream, true);
  assert.deepEqual(deltas, [
    { type: "reasoning", text: "plan" },
    { type: "answer", text: "ok" },
  ]);
});


test("sendChat reports OpenAI-compatible error messages", async () => {
  await assert.rejects(
    () => sendChat(messages, {
      endpoint: "http://localhost:1234/v1",
      model: "loaded-model",
      fetchImpl: async () => jsonResponse({ error: { message: "model is loading" } }, 503),
    }),
    /model is loading/,
  );
});

test("sendChat reports HTTP status when an error response is not JSON", async () => {
  await assert.rejects(
    () => sendChat(messages, {
      endpoint: "http://localhost:1234/v1",
      model: "loaded-model",
      fetchImpl: async () => new Response("busy", { status: 503 }),
    }),
    /HTTP 503/,
  );
});

test("sendChat reports missing assistant content", async () => {
  await assert.rejects(
    () => sendChat(messages, {
      endpoint: "http://localhost:1234/v1",
      model: "loaded-model",
      fetchImpl: async () => jsonResponse({ choices: [] }),
    }),
    /assistant content/,
  );
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
