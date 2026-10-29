const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveAutocompleteTarget } = require("../dist/autocompleteTarget.js");

test("explicit autocomplete endpoint wins and keeps explicit model", async () => {
  const result = await resolveAutocompleteTarget({
    chatEndpoint: "http://localhost:1234/v1",
    chatEndpointConfigured: true,
    autocomplete: {
      endpoint: "http://gpuhost:8080/v1",
      endpointConfigured: true,
      model: "qwen-fim",
    },
  }, {
    resolveChatTargetImpl: async ({ endpoint }) => ({ endpoint, model: "ignored" }),
  });

  assert.deepEqual(result, {
    available: true,
    endpoint: "http://gpuhost:8080/v1",
    root: "http://gpuhost:8080",
    model: "qwen-fim",
    source: "configured",
    remote: true,
  });
});

test("autocomplete reuses a non-local chat endpoint when no autocomplete endpoint is set", async () => {
  let preferredModel;
  const result = await resolveAutocompleteTarget({
    chatEndpoint: "https://gateway.example/v1",
    chatEndpointConfigured: true,
    chatModel: "qwen-coder-local",
    autocomplete: {
      endpoint: "",
      endpointConfigured: false,
      model: "",
    },
  }, {
    resolveChatTargetImpl: async ({ endpoint, preferredModel: preferred }) => {
      preferredModel = preferred;
      return { endpoint, model: preferred };
    },
  });

  assert.deepEqual(result, {
    available: true,
    endpoint: "https://gateway.example/v1",
    root: "https://gateway.example",
    model: "qwen-coder-local",
    source: "chat-fallback",
    remote: true,
  });
  assert.equal(preferredModel, "qwen-coder-local");
});

test("autocomplete ignores a stale autocomplete.model when reusing the chat endpoint", async () => {
  const result = await resolveAutocompleteTarget({
    chatEndpoint: "https://gateway.example/v1",
    chatEndpointConfigured: true,
    autocomplete: {
      endpoint: "",
      endpointConfigured: false,
      model: "qwen3-coder-next",
    },
    }, {
      resolveChatTargetImpl: async ({ endpoint }) => ({ endpoint, model: "Qwen3.8-27B" }),
  });

  assert.equal(result.available, true);
  assert.equal(result.model, "Qwen3.8-27B");
  assert.equal(result.source, "chat-fallback");
});

test("autocomplete falls back to the local chat endpoint when safe", async () => {
  const result = await resolveAutocompleteTarget({
    chatEndpoint: "http://localhost:1234/v1",
    chatEndpointConfigured: true,
    autocomplete: {
      endpoint: "",
      endpointConfigured: false,
      model: "",
    },
  }, {
    resolveChatTargetImpl: async ({ endpoint }) => ({ endpoint, model: "qwen2.5-coder-14b" }),
  });

  assert.deepEqual(result, {
    available: true,
    endpoint: "http://localhost:1234/v1",
    root: "http://localhost:1234",
    model: "qwen2.5-coder-14b",
    source: "chat-fallback",
    remote: false,
  });
});

test("autocomplete refuses a chat-only family (Gemma) reused for FIM", async () => {
  const result = await resolveAutocompleteTarget({
    chatEndpoint: "http://localhost:8080/v1",
    chatEndpointConfigured: true,
    autocomplete: {
      endpoint: "",
      endpointConfigured: false,
      model: "",
    },
  }, {
    resolveChatTargetImpl: async ({ endpoint }) => ({ endpoint, model: "gemma-4-31b-it" }),
  });

  assert.equal(result.available, false);
  assert.match(result.reason, /chat-only family without FIM tokens/i);
});

test("autocomplete reuses a Qwen chat model for FIM", async () => {
  const result = await resolveAutocompleteTarget({
    chatEndpoint: "http://localhost:8080/v1",
    chatEndpointConfigured: true,
    autocomplete: {
      endpoint: "",
      endpointConfigured: false,
      model: "",
    },
    }, {
      resolveChatTargetImpl: async ({ endpoint }) => ({ endpoint, model: "Qwen3.8-27B" }),
  });

  assert.deepEqual(result, {
    available: true,
    endpoint: "http://localhost:8080/v1",
    root: "http://localhost:8080",
    model: "Qwen3.8-27B",
    source: "chat-fallback",
    remote: false,
  });
});

test("autocomplete omits the compatibility fallback model alias", async () => {
  const result = await resolveAutocompleteTarget({
    chatEndpoint: "http://localhost:8080/v1",
    chatEndpointConfigured: true,
    autocomplete: {
      endpoint: "",
      endpointConfigured: false,
      model: "",
    },
  }, {
    resolveChatTargetImpl: async ({ endpoint }) => ({ endpoint, model: "local-model" }),
  });

  assert.deepEqual(result, {
    available: true,
    endpoint: "http://localhost:8080/v1",
    root: "http://localhost:8080",
    model: undefined,
    source: "chat-fallback",
    remote: false,
  });
});

function keyInput(autocompleteEndpoint) {
  return {
    chatEndpoint: "https://gateway.example/v1",
    chatEndpointConfigured: true,
    apiKey: "k-123",
    autocomplete: { endpoint: autocompleteEndpoint, endpointConfigured: Boolean(autocompleteEndpoint), model: "" },
  };
}

test("chat key reaches the model probe and the target for the chat endpoint", async () => {
  for (const endpoint of ["", "https://gateway.example/v1/", "https://gateway.example"]) {
    let probeKey;
    const result = await resolveAutocompleteTarget(keyInput(endpoint), {
      resolveChatTargetImpl: async ({ endpoint: e, apiKey }) => {
        probeKey = apiKey;
        return { endpoint: e, model: "qwen-coder" };
      },
    });
    assert.equal(probeKey, "k-123");
    assert.equal(result.apiKey, "k-123");
  }
});

test("chat key is not sent to a different autocomplete endpoint", async () => {
  let probeKey = "unset";
  const result = await resolveAutocompleteTarget(keyInput("https://other.example/v1"), {
    resolveChatTargetImpl: async ({ endpoint, apiKey }) => {
      probeKey = apiKey;
      return { endpoint, model: "qwen-coder" };
    },
  });
  assert.equal(probeKey, undefined);
  assert.equal(result.apiKey, undefined);
});

test("401 reason for autocomplete does not ask for a chat model", async () => {
  const reject = async ({ endpoint }) => {
    throw new Error(`${endpoint} refused the request with HTTP 401: no API key. Set a model with hackl.model.`);
  };
  const same = await resolveAutocompleteTarget(keyInput(""), { resolveChatTargetImpl: reject });
  assert.equal(same.available, false);
  assert.match(same.reason, /HTTP 401/);
  assert.match(same.reason, /Set API Key/);
  assert.doesNotMatch(same.reason, /hackl\.model/);
  const other = await resolveAutocompleteTarget(keyInput("https://other.example/v1"), { resolveChatTargetImpl: reject });
  assert.match(other.reason, /chat API key is not sent/);
  assert.doesNotMatch(other.reason, /hackl\.model/);
});
