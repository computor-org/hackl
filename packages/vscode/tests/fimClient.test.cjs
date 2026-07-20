const assert = require("node:assert/strict");
const test = require("node:test");
const {
  requestFim,
  capPrefix,
  capSuffix,
  trimAtStops,
  dedupeAgainstSuffix,
} = require("../dist/fimClient.js");

const QWEN_SUPPORT = {
  supported: true,
  dialect: "qwen",
  stop: ["<|fim_pad|>", "<|endoftext|>", "<|im_end|>"],
  template: (prefix, suffix) => `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`,
};

function ok(content) {
  return { ok: true, json: async () => ({ content }) };
}

function notOk() {
  return { ok: false, json: async () => ({}) };
}

test("capPrefix keeps tail under cap", () => {
  assert.equal(capPrefix("a".repeat(5000)).length, 4000);
});

test("capSuffix keeps head under cap", () => {
  assert.equal(capSuffix("b".repeat(3000)).length, 2000);
});

test("capPrefix limits by line count too", () => {
  const result = capPrefix(new Array(200).fill("x").join("\n"));
  assert.equal(result.split("\n").length, 80);
});

test("trimAtStops cuts at first stop", () => {
  assert.equal(trimAtStops("foo<|im_end|>bar", ["<|im_end|>"]), "foo");
  assert.equal(trimAtStops("clean", ["<|im_end|>"]), "clean");
});

test("dedupeAgainstSuffix removes trailing duplicate of suffix start", () => {
  const suffix = "}\n";
  const completion = "  console.log(x);\n" + suffix;
  assert.equal(dedupeAgainstSuffix(completion, suffix), "  console.log(x);\n");
});

test("requestFim posts /infill with input_prefix and input_suffix", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return ok("answer");
  };
  const result = await requestFim(
    { root: "http://localhost:8080", support: QWEN_SUPPORT, fetchImpl, model: "qwen" },
    { prefix: "before", suffix: "after", maxTokens: 32 },
  );
  assert.equal(result, "answer");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/infill"));
  assert.equal(calls[0].body.input_prefix, "before");
  assert.equal(calls[0].body.input_suffix, "after");
  assert.equal(calls[0].body.model, "qwen");
  assert.equal(calls[0].body.cache_prompt, true);
  assert.equal(calls[0].headers["x-model"], undefined);
});

test("requestFim falls back to /completion when /infill fails", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return String(url).endsWith("/infill") ? notOk() : ok("done");
  };
  const result = await requestFim(
    { root: "http://localhost:8080", support: QWEN_SUPPORT, fetchImpl },
    { prefix: "p", suffix: "s", maxTokens: 16 },
  );
  assert.equal(result, "done");
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.endsWith("/completion"));
  assert.equal(calls[1].body.prompt, "<|fim_prefix|>p<|fim_suffix|>s<|fim_middle|>");
});

test("requestFim returns undefined when both endpoints fail", async () => {
  const result = await requestFim(
    { root: "http://localhost:8080", support: QWEN_SUPPORT, fetchImpl: async () => notOk() },
    { prefix: "p", suffix: "s", maxTokens: 16 },
  );
  assert.equal(result, undefined);
});
