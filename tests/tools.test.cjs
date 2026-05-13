const assert = require("node:assert/strict");
const test = require("node:test");
const { splitReasoning } = require("../dist/reasoning.js");
const { estimateChatTokens, formatTokenBudget } = require("../dist/tokenBudget.js");
const { completeWithTools } = require("../dist/toolLoop.js");
const { buildToolResultMessage, isPossibleToolPrefix, parseToolRequest } = require("../dist/tools.js");

test("parseToolRequest reads Qwen-friendly HACKL_TOOL JSON", () => {
  assert.deepEqual(
    parseToolRequest('HACKL_TOOL {"name":"read_file","path":"src/a.ts","start_line":2,"end_line":4}'),
    { name: "read_file", path: "src/a.ts", start_line: 2, end_line: 4 },
  );
  assert.equal(parseToolRequest("no tool"), undefined);
  assert.equal(parseToolRequest('HACKL_TOOL {"name":"run","path":"x"}'), undefined);
});

test("parseToolRequest reads exact replacement edit requests", () => {
  assert.deepEqual(
    parseToolRequest('HACKL_TOOL {"name":"replace_text","path":"src/a.ts","old_text":"const x = 1;","new_text":"const x = 2;"}'),
    { name: "replace_text", path: "src/a.ts", old_text: "const x = 1;", new_text: "const x = 2;" },
  );
  assert.equal(parseToolRequest('HACKL_TOOL {"name":"replace_text","path":"src/a.ts","old_text":"","new_text":"x"}'), undefined);
});

test("parseToolRequest reads bounded search requests", () => {
  assert.deepEqual(
    parseToolRequest('HACKL_TOOL {"name":"search_files","query":"ChatSession","glob":"src/**/*.ts","max_results":99}'),
    { name: "search_files", query: "ChatSession", glob: "src/**/*.ts", max_results: 50 },
  );
  assert.equal(parseToolRequest('HACKL_TOOL {"name":"search_files","query":" "}'), undefined);
});

test("parseToolRequest reads bounded command requests", () => {
  assert.deepEqual(
    parseToolRequest('HACKL_TOOL {"name":"run_command","cmd":"npm","args":["test"],"timeout_ms":999999}'),
    { name: "run_command", cmd: "npm", args: ["test"], timeout_ms: 600000 },
  );
  assert.equal(parseToolRequest('HACKL_TOOL {"name":"run_command","cmd":"npm","args":"test"}'), undefined);
});

test("buildToolResultMessage returns a compact tool result block", () => {
  assert.match(
    buildToolResultMessage({ name: "read_file", path: "src/a.ts" }, { ok: true, content: "1: const x = 1;" }),
    /HACKL_TOOL_RESULT read_file ok\npath: src\/a\.ts\n\n1: const x = 1;/,
  );
});

test("buildToolResultMessage reports edit tool results", () => {
  assert.match(
    buildToolResultMessage(
      { name: "replace_text", path: "src/a.ts", old_text: "a", new_text: "b" },
      { ok: true, content: "Replaced text in src/a.ts." },
    ),
    /HACKL_TOOL_RESULT replace_text ok\npath: src\/a\.ts\n\nReplaced text/,
  );
});

test("isPossibleToolPrefix holds only plausible streamed tool prefixes", () => {
  assert.equal(isPossibleToolPrefix("HACK"), true);
  assert.equal(isPossibleToolPrefix("HACKL_TOOL {"), true);
  assert.equal(isPossibleToolPrefix("The answer"), false);
});

test("splitReasoning separates think blocks from the final answer", () => {
  assert.deepEqual(splitReasoning("<think>check units</think>\n\nUse $F=ma$."), {
    reasoning: "check units",
    answer: "Use $F=ma$.",
  });
});

test("token budget estimates and formats prompt size", () => {
  const estimate = estimateChatTokens([{ role: "user", content: "abcdabcd" }]);
  assert.equal(estimate, 7);
  assert.equal(formatTokenBudget(250, 1000), "~250 / 1,000 tokens (25%)");
});

test("completeWithTools runs read_file before final answer", async () => {
  const calls = [];
  const progress = [];
  const backend = {
    async complete(messages, options) {
      calls.push(messages.map((message) => message.content));
      if (calls.length === 1) {
        options.onDelta({ type: "answer", text: 'HACKL_TOOL {"name":"read_file","path":"src/a.ts"}' });
        return { content: 'HACKL_TOOL {"name":"read_file","path":"src/a.ts"}' };
      }
      options.onDelta({ type: "answer", text: "final answer" });
      return { content: "final answer" };
    },
  };

  const answer = await completeWithTools({
    backend,
    messages: [{ role: "user", content: "question" }],
    maxToolCalls: 2,
    progress: (event) => progress.push(event),
    runTool: async () => ({ ok: true, content: "1: const x = 1;" }),
  });

  assert.equal(answer.content, "final answer");
  assert.equal(calls.length, 2);
  assert.match(calls[1].at(-1), /HACKL_TOOL_RESULT read_file ok/);
  assert.deepEqual(progress.filter((event) => event.type === "delta").map((event) => event.text), ["final answer"]);
});
