const assert = require("node:assert/strict");
const test = require("node:test");
const { detectFim, toRootBase, buildQwenPrompt, fimCapableByModelName, fimSupportByModelName } = require("../dist/fimDetect.js");

test("fimCapableByModelName treats the Qwen line as FIM-capable", () => {
  assert.equal(fimCapableByModelName("qwen"), true);
  assert.equal(fimCapableByModelName("Qwen3.8-27B"), true);
  assert.equal(fimCapableByModelName("qwen2.5-coder-7b-instruct"), true);
});

test("fimCapableByModelName rejects plain Gemma but not CodeGemma", () => {
  assert.equal(fimCapableByModelName("gemma-4-31b-it"), false);
  assert.equal(fimCapableByModelName("codegemma-7b"), true);
});

test("fimCapableByModelName returns undefined for unknown or empty ids", () => {
  assert.equal(fimCapableByModelName("local-model"), undefined);
  assert.equal(fimCapableByModelName(""), undefined);
  assert.equal(fimCapableByModelName(undefined), undefined);
});

test("fimSupportByModelName maps known model families to their dialect", () => {
  assert.equal(fimSupportByModelName("unsloth/qwen3.8:27b@128k")?.dialect, "qwen");
  assert.equal(fimSupportByModelName("codegemma-7b")?.dialect, "codegemma");
  assert.equal(fimSupportByModelName("CodeLlama-13b")?.dialect, "codellama");
  assert.equal(fimSupportByModelName("codestral")?.dialect, undefined);
});

function jsonResponse(body, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

function makeFetch(tokensByContent) {
  return async (_url, init) => {
    const content = init?.body ? JSON.parse(init.body).content : undefined;
    const tokens = tokensByContent[content];
    if (tokens === undefined) return jsonResponse({}, false);
    return jsonResponse({ tokens: new Array(tokens).fill(0) });
  };
}

function captureFetch(tokensByContent, calls) {
  return async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    const content = init?.body ? JSON.parse(init.body).content : undefined;
    const tokens = tokensByContent[content];
    if (tokens === undefined) return jsonResponse({}, false);
    return jsonResponse({ tokens: new Array(tokens).fill(0) });
  };
}

test("toRootBase strips /v1 and trailing slash", () => {
  assert.equal(toRootBase("http://localhost:8080/v1"), "http://localhost:8080");
  assert.equal(toRootBase("http://localhost:8080/v1/"), "http://localhost:8080");
  assert.equal(toRootBase("http://localhost:8080/api/fim/v1/"), "http://localhost:8080/api/fim");
});

test("buildQwenPrompt assembles the Qwen FIM template", () => {
  assert.equal(buildQwenPrompt("a", "b"), "<|fim_prefix|>a<|fim_suffix|>b<|fim_middle|>");
});

test("detectFim returns qwen when fim markers tokenize as one token", async () => {
  const result = await detectFim({ root: "http://localhost:8080", fetchImpl: makeFetch({ "<|fim_prefix|>": 1, "<|file_separator|>": 6 }) });
  assert.equal(result.supported, true);
  assert.equal(result.dialect, "qwen");
});

test("detectFim trusts a known Qwen model without requiring /tokenize", async () => {
  let fetched = false;
  const result = await detectFim({
    root: "https://gateway.example",
    model: "qwen-coder-local",
    fetchImpl: async () => {
      fetched = true;
      throw new Error("gateway does not proxy /tokenize");
    },
  });
  assert.equal(result.supported, true);
  assert.equal(result.dialect, "qwen");
  assert.equal(fetched, false);
});

test("detectFim routes /tokenize via the JSON model without an x-model header", async () => {
  const calls = [];
  const result = await detectFim({
    root: "http://localhost:8080",
    model: "codestral-latest",
    fetchImpl: captureFetch({ "<|fim_prefix|>": 1, "<|file_separator|>": 6 }, calls),
  });
  assert.equal(result.supported, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://localhost:8080/tokenize");
  // A routed gateway rejects an x-model header on /tokenize with
  // HTTP 400, so detection must send a plain request and route via the body.
  assert.equal(calls[0].headers["x-model"], undefined);
  assert.equal(calls[0].body.model, "codestral-latest");
  assert.equal(calls[0].body.add_special, false);
});

test("detectFim returns codegemma when file_separator is one token", async () => {
  const result = await detectFim({ root: "http://localhost:8080", fetchImpl: makeFetch({ "<|fim_prefix|>": 1, "<|file_separator|>": 1 }) });
  assert.equal(result.supported, true);
  assert.equal(result.dialect, "codegemma");
});

test("detectFim returns codellama when PRE is one token", async () => {
  const result = await detectFim({ root: "http://localhost:8080", fetchImpl: makeFetch({ "<|fim_prefix|>": 4, "<PRE>": 1 }) });
  assert.equal(result.supported, true);
  assert.equal(result.dialect, "codellama");
});

test("detectFim reports unsupported when no markers are single tokens", async () => {
  const result = await detectFim({ root: "http://localhost:8080", fetchImpl: makeFetch({ "<|fim_prefix|>": 4, "<|file_separator|>": 6, "<PRE>": 3 }) });
  assert.equal(result.supported, false);
  assert.match(result.reason, /FIM/);
});
