const assert = require("node:assert/strict");
const test = require("node:test");

const { buildBackend, normalizeBackendChoice, pickAvailableModel } = require("../dist/backendRegistry.js");

test("normalizeBackendChoice accepts {kind:'codex',model}", () => {
  assert.deepEqual(
    normalizeBackendChoice({ kind: "codex", model: "gpt-5-codex" }),
    { kind: "codex", model: "gpt-5-codex", endpoint: undefined },
  );
});

test("normalizeBackendChoice accepts {kind:'local',model,endpoint}", () => {
  assert.deepEqual(
    normalizeBackendChoice({ kind: "local", model: "qwen", endpoint: "http://127.0.0.1:8080/v1" }),
    { kind: "local", model: "qwen", endpoint: "http://127.0.0.1:8080/v1" },
  );
});

test("normalizeBackendChoice rejects bad shapes", () => {
  assert.equal(normalizeBackendChoice(null), undefined);
  assert.equal(normalizeBackendChoice({ kind: "remote", model: "x" }), undefined);
  assert.equal(normalizeBackendChoice({ kind: "codex" }), undefined);
});

test("pickAvailableModel keeps the selected model when Codex still offers it", () => {
  assert.equal(
    pickAvailableModel(["gpt-5.5", "gpt-5.4-mini"], "gpt-5.4-mini"),
    "gpt-5.4-mini",
  );
});

test("pickAvailableModel falls back to the first available model", () => {
  assert.equal(pickAvailableModel(["gpt-5.5", "gpt-5.4"], "old-model"), "gpt-5.5");
  assert.equal(pickAvailableModel([], "old-model"), undefined);
});

test("buildBackend returns a backend for both kinds", () => {
  const local = buildBackend({
    choice: { kind: "local", endpoint: "http://127.0.0.1:8080/v1", model: "qwen" },
  });
  assert.equal(typeof local.complete, "function");

  // codex backend: no child process is spawned until complete() runs.
  const codex = buildBackend({
    choice: { kind: "codex", model: "gpt-5-codex" },
    codexCommand: "/bin/true",
  });
  assert.equal(typeof codex.complete, "function");
});

test("buildBackend rejects local without endpoint", () => {
  assert.throws(() => buildBackend({ choice: { kind: "local", model: "qwen" } }), /endpoint/i);
});
