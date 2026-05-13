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
