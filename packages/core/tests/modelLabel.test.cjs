const assert = require("node:assert/strict");
const test = require("node:test");
const { shortModelLabel } = require("../dist/modelLabel.js");

test("shortModelLabel keeps the size for a bare family name", () => {
  assert.equal(shortModelLabel("unsloth/qwen3.6:35b-a3b@128k"), "qwen3.6:35b");
  assert.equal(shortModelLabel("unsloth/qwen3.5:122b-a10b@128k"), "qwen3.5:122b");
});

test("shortModelLabel drops the size for a descriptive name", () => {
  assert.equal(shortModelLabel("qwen/qwen3-coder-next:80b-a3b-q4km@32k"), "qwen3-coder-next");
});

test("shortModelLabel leaves a plain id untouched", () => {
  assert.equal(shortModelLabel("gpt-5.4-mini"), "gpt-5.4-mini");
  assert.equal(shortModelLabel("local-model"), "local-model");
  assert.equal(shortModelLabel(""), "");
});
