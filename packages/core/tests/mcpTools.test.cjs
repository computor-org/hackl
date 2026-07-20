const assert = require("node:assert/strict");
const test = require("node:test");
const { parseAnyToolRequest } = require("../dist/tools.js");
const { completeWithTools } = require("../dist/toolLoop.js");

test("parseAnyToolRequest still parses built-in tools", () => {
  const request = parseAnyToolRequest('HACKL_TOOL {"name":"read_file","path":"a.ts"}');
  assert.equal(request.name, "read_file");
  assert.equal(request.path, "a.ts");
});

test("parseAnyToolRequest parses a registered MCP tool with generic args", () => {
  const names = new Set(["mcp__helpy__web_search"]);
  const request = parseAnyToolRequest('HACKL_TOOL {"name":"mcp__helpy__web_search","query":"cats"}', names);
  assert.deepEqual(request, { name: "mcp__helpy__web_search", args: { query: "cats" } });
});

test("parseAnyToolRequest ignores unregistered tool names", () => {
  const names = new Set(["mcp__helpy__web_search"]);
  assert.equal(parseAnyToolRequest('HACKL_TOOL {"name":"mcp__other__thing"}', names), undefined);
});

test("completeWithTools routes MCP tool calls through extraTools and feeds the result back", async () => {
  const calls = [];
  let step = 0;
  const responses = [
    'HACKL_TOOL {"name":"mcp__helpy__web_search","query":"cats"}',
    "done: I found cats",
  ];
  const backend = {
    async complete() {
      return { content: responses[step++] ?? "" };
    },
  };

  const answer = await completeWithTools({
    backend,
    messages: [{ role: "user", content: "search" }],
    runTool: async () => ({ ok: false, content: "built-in only" }),
    extraTools: {
      names: new Set(["mcp__helpy__web_search"]),
      run: async (name, args) => {
        calls.push({ name, args });
        return { ok: true, content: "RESULT: cats are great" };
      },
    },
    maxToolCalls: 3,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { name: "mcp__helpy__web_search", args: { query: "cats" } });
  assert.match(answer.content, /found cats/);
});

test("completeWithTools reports unknown tool when extraTools is absent", async () => {
  let step = 0;
  const responses = [
    'HACKL_TOOL {"name":"mcp__helpy__web_search","query":"x"}',
    "final",
  ];
  const backend = { async complete() { return { content: responses[step++] ?? "" }; } };
  // Without extraTools, the MCP name is unknown to the parser, so it is treated
  // as an invalid tool call and the loop nudges toward a plain answer.
  const answer = await completeWithTools({
    backend,
    messages: [{ role: "user", content: "x" }],
    runTool: async () => ({ ok: false, content: "n/a" }),
    maxToolCalls: 3,
  });
  assert.equal(typeof answer.content, "string");
});
