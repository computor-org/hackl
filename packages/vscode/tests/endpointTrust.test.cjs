const assert = require("node:assert/strict");
const test = require("node:test");
const {
  clearTrustedEndpoints,
  isEndpointTrusted,
  normalizeTrustedEndpoint,
  trustEndpoint,
} = require("../dist/endpointTrust.js");

function memoryStore() {
  const values = new Map();
  return {
    get: (key) => values.get(key),
    update: async (key, value) => { values.set(key, value); },
  };
}

test("trusted endpoint normalization ignores a trailing slash", async () => {
  const store = memoryStore();
  await trustEndpoint(store, "https://gateway.example/v1/");
  assert.equal(isEndpointTrusted(store, "https://gateway.example/v1"), true);
  assert.equal(isEndpointTrusted(store, "https://other.example/v1"), false);
});

test("trusted endpoints can be revoked", async () => {
  const store = memoryStore();
  await trustEndpoint(store, "https://gateway.example/v1");
  await clearTrustedEndpoints(store);
  assert.equal(isEndpointTrusted(store, "https://gateway.example/v1"), false);
});

test("invalid endpoints are never trusted", async () => {
  const store = memoryStore();
  await trustEndpoint(store, "not a url");
  assert.equal(normalizeTrustedEndpoint("not a url"), undefined);
  assert.equal(isEndpointTrusted(store, "not a url"), false);
});
