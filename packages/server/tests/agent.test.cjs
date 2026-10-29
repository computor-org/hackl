const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createServerAgent } = require("../dist/agent.js");

// Key-protected OpenAI-compatible endpoint as seen by `hackl serve`: /health is
// open, /models and /chat/completions answer 401 without the bearer token.
async function withAuthStub(fn) {
  const server = http.createServer((request, response) => {
    const authed = request.headers.authorization === "Bearer stub-key";
    if (request.url === "/health") {
      response.writeHead(200);
      response.end("ok");
      return;
    }
    if (request.url === "/v1/models" && authed) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "gateway-model" }] }));
      return;
    }
    if (request.url === "/v1/chat/completions" && authed) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        choices: [{ message: { content: "stub answer" } }],
        model: "gateway-model",
      }));
      return;
    }
    response.writeHead(401);
    response.end("unauthorized");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}/v1`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("createServerAgent discovers the model through the configured API key", async () => {
  await withAuthStub(async (endpoint) => {
    const agent = await createServerAgent({
      HACKL_ENDPOINT: endpoint,
      HACKL_API_KEY: "stub-key",
    });

    assert.equal(agent.model, "gateway-model");
    assert.equal(agent.endpoint, endpoint);
  });
});

test("createServerAgent asks for a model instead of guessing one it cannot use", async () => {
  await withAuthStub(async (endpoint) => {
    await assert.rejects(
      createServerAgent({ HACKL_ENDPOINT: endpoint }),
      /No model found at .*hackl\.model/,
    );
  });
});
