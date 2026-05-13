const assert = require("node:assert/strict");
const test = require("node:test");
const { detectFim, toRootBase, buildQwenPrompt } = require("../dist/fimDetect.js");

function jsonResponse(body, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

function makeFetch(tokensByContent) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    const content = init?.body ? JSON.parse(init.body).content : undefined;
    const tokens = tokensByContent[content];
    if (tokens === undefined) return jsonResponse({}, false);
    return jsonResponse({ tokens: new Array(tokens).fill(0) });
  };
  fn.calls = calls;
  return fn;
}

test("toRootBase strips trailing /v1", () => {
  assert.equal(toRootBase("http://localhost:8080/v1"), "http://localhost:8080");
  assert.equal(toRootBase("http://localhost:8080/v1/"), "http://localhost:8080");
  assert.equal(toRootBase("http://localhost:8080/"), "http://localhost:8080");
});

test("buildQwenPrompt assembles Qwen FIM template", () => {
  assert.equal(buildQwenPrompt("a", "b"), "<|fim_prefix|>a<|fim_suffix|>b<|fim_middle|>");
});

test("detectFim returns qwen when only fim_prefix is one token", async () => {
  const fetchImpl = makeFetch({ "<|fim_prefix|>": 1, "<|file_separator|>": 6, "<PRE>": 3 });
  const result = await detectFim({ root: "http://localhost:8080", fetchImpl });
  assert.equal(result.supported, true);
  assert.equal(result.dialect, "qwen");
  assert.ok(result.stop.includes("<|fim_pad|>"));
});

test("detectFim returns codegemma when file_separator is one token", async () => {
  const fetchImpl = makeFetch({ "<|fim_prefix|>": 1, "<|file_separator|>": 1 });
  const result = await detectFim({ root: "http://localhost:8080", fetchImpl });
  assert.equal(result.supported, true);
  assert.equal(result.dialect, "codegemma");
  assert.ok(result.stop.includes("<|file_separator|>"));
});

test("detectFim returns codellama when <PRE> is one token", async () => {
  const fetchImpl = makeFetch({ "<|fim_prefix|>": 4, "<PRE>": 1 });
  const result = await detectFim({ root: "http://localhost:8080", fetchImpl });
  assert.equal(result.supported, true);
  assert.equal(result.dialect, "codellama");
  assert.ok(result.template("a", "b").startsWith("<PRE>"));
});

test("detectFim reports unsupported when no markers are single tokens", async () => {
  const fetchImpl = makeFetch({ "<|fim_prefix|>": 4, "<|file_separator|>": 6, "<PRE>": 3 });
  const result = await detectFim({ root: "http://localhost:8080", fetchImpl });
  assert.equal(result.supported, false);
  assert.match(result.reason, /FIM/);
});

test("detectFim returns unsupported when /tokenize is unreachable", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNREFUSED");
  };
  const result = await detectFim({ root: "http://localhost:8080", fetchImpl });
  assert.equal(result.supported, false);
  assert.match(result.reason, /tokenize/);
});
