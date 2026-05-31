const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveAutocompleteTarget } = require("../dist/autocompleteTarget.js");

test("explicit autocomplete endpoint wins and keeps explicit model", async () => {
  const result = await resolveAutocompleteTarget({
    chatEndpoint: "http://localhost:1234/v1",
    chatEndpointConfigured: true,
    autocomplete: {
      endpoint: "http://faepmac1:8080/v1",
      endpointConfigured: true,
      model: "qwen-fim",
    },
  }, {
    resolveChatTargetImpl: async ({ endpoint }) => ({ endpoint, model: "ignored" }),
  });

  assert.deepEqual(result, {
    available: true,
    endpoint: "http://faepmac1:8080/v1",
    root: "http://faepmac1:8080",
    model: "qwen-fim",
    source: "configured",
    remote: true,
  });
});

test("autocomplete does not automatically reuse a non-local chat endpoint", async () => {
  const result = await resolveAutocompleteTarget({
    chatEndpoint: "http://slopgate.example/v1",
    chatEndpointConfigured: true,
    autocomplete: {
      endpoint: "",
      endpointConfigured: false,
      model: "",
    },
  });

  assert.equal(result.available, false);
  assert.match(result.reason, /does not automatically reuse a non-local hackl\.endpoint/i);
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
