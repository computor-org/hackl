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
  assert.deepEqual(
    parseToolRequest('HACKL_TOOL {"name":"read","file":"src/a.ts","line":7}'),
    { name: "read_file", path: "src/a.ts", start_line: 7, end_line: undefined },
  );
  assert.equal(parseToolRequest("no tool"), undefined);
  assert.equal(parseToolRequest('HACKL_TOOL {"name":"run","path":"x"}'), undefined);
});

test("parseToolRequest reads exact replacement edit requests", () => {
  assert.deepEqual(
    parseToolRequest('HACKL_TOOL {"name":"replace_text","path":"src/a.ts","old_text":"const x = 1;","new_text":"const x = 2;"}'),
    { name: "replace_text", path: "src/a.ts", old_text: "const x = 1;", new_text: "const x = 2;" },
  );
  assert.deepEqual(
    parseToolRequest('HACKL_TOOL {"name":"edit","file":"src/a.ts","old":"a","new":"b"}'),
    { name: "replace_text", path: "src/a.ts", old_text: "a", new_text: "b" },
  );
  assert.equal(parseToolRequest('HACKL_TOOL {"name":"replace_text","path":"src/a.ts","old_text":"","new_text":"x"}'), undefined);
});

test("parseToolRequest reads bounded search requests", () => {
  assert.deepEqual(
    parseToolRequest('HACKL_TOOL {"name":"search_files","query":"ChatSession","glob":"src/**/*.ts","max_results":99}'),
    { name: "search_files", query: "ChatSession", glob: "src/**/*.ts", max_results: 50 },
  );
  assert.deepEqual(
    parseToolRequest('HACKL_TOOL {"name":"search_files","query":"","glob":"**/*","max_results":50}'),
    { name: "search_files", query: "", glob: "**/*", max_results: 50 },
  );
  assert.deepEqual(
    parseToolRequest('HACKL_TOOL {"name":"grep","pattern":"TODO","files":"src/**/*.ts"}'),
    { name: "search_files", query: "TODO", glob: "src/**/*.ts", max_results: undefined },
  );
  assert.equal(parseToolRequest('HACKL_TOOL {"name":"search_files","query":" "}'), undefined);
});

test("parseToolRequest reads bounded command requests", () => {
  assert.deepEqual(
    parseToolRequest('HACKL_TOOL {"name":"run_command","cmd":"npm","args":["test"],"timeout_ms":999999}'),
    { name: "run_command", cmd: "npm", args: ["test"], timeout_ms: 600000 },
  );
  assert.deepEqual(
    parseToolRequest('HACKL_TOOL {"name":"command","command":"npm","args":"run test"}'),
    { name: "run_command", cmd: "npm", args: ["run", "test"], timeout_ms: undefined },
  );
  assert.deepEqual(
    parseToolRequest('HACKL_TOOL {"name":"run_command","cmd":"node","args":["-e",1]}'),
    { name: "run_command", cmd: "node", args: ["-e", "1"], timeout_ms: undefined },
  );
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

test("completeWithTools reports token metrics after tool results", async () => {
  const progress = [];
  let calls = 0;
  const backend = {
    async complete() {
      calls += 1;
      if (calls === 1) {
        return { content: 'HACKL_TOOL {"name":"read_file","path":"src/a.ts"}' };
      }
      return { content: "done" };
    },
  };

  await completeWithTools({
    backend,
    messages: [{ role: "user", content: "read" }],
    maxToolCalls: 2,
    maxContextTokens: 1000,
    progress: (event) => progress.push(event),
    runTool: async () => ({ ok: true, content: "1: const x = 1;" }),
  });

  const metrics = progress.filter((event) => event.type === "phase" && event.inputTokens !== undefined);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].maxContextTokens, 1000);
  assert.match(metrics[0].text, /Context ~\d+ \/ 1,000 tokens/);
});

test("completeWithTools auto-compacts before the next model turn", async () => {
  const calls = [];
  const backend = {
    async complete(messages, options) {
      calls.push({ messages, options });
      if (messages[0].content.includes("Checkpoint older context")) {
        return { content: "Summary of the older coding trajectory." };
      }
      return { content: "done" };
    },
  };
  const messages = [
    { role: "system", content: "system" },
    { role: "user", content: "current task" },
    { role: "assistant", content: `HACKL_TOOL ${"old evidence ".repeat(1800)}` },
    { role: "user", content: `HACKL_TOOL_RESULT run_command ok\n\n${"old output ".repeat(1800)}` },
    { role: "assistant", content: "recent observation" },
  ];

  const answer = await completeWithTools({
    backend,
    messages,
    maxToolCalls: 1,
    maxContextTokens: 8192,
    compactKeepTurns: 1,
    runTool: async () => ({ ok: true, content: "unused" }),
  });

  assert.equal(answer.content, "done");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.enableThinking, false);
  assert.equal(calls[0].options.maxOutputTokens, 4096);
  assert.match(calls[1].messages[2].content, /CONTEXT CHECKPOINT/);
});

test("completeWithTools reports token metrics after invalid tool feedback", async () => {
  const progress = [];
  let calls = 0;
  const backend = {
    async complete() {
      calls += 1;
      if (calls === 1) {
        return { content: "HACKL_TOOL invalid" };
      }
      return { content: "done" };
    },
  };

  await completeWithTools({
    backend,
    messages: [{ role: "user", content: "bad tool" }],
    maxToolCalls: 2,
    maxContextTokens: 1000,
    progress: (event) => progress.push(event),
    runTool: async () => ({ ok: true, content: "unused" }),
  });

  assert.equal(progress.some((event) => event.type === "phase" && event.inputTokens !== undefined), true);
});

test("completeWithTools explains tool-only forced final answers", async () => {
  const debug = [];
  const backend = {
    async complete() {
      return { content: 'HACKL_TOOL {"name":"read_file","path":"src/a.ts"}' };
    },
  };

  const answer = await completeWithTools({
    backend,
    messages: [{ role: "user", content: "question" }],
    maxToolCalls: 0,
    debug: (event, data) => debug.push({ event, data }),
    runTool: async () => ({ ok: true, content: "unused" }),
  });

  assert.match(answer.content, /did not receive usable assistant text/);
  assert.ok(debug.some((entry) => entry.event === "toolLoop.toolLimit"));
  assert.ok(debug.some((entry) => entry.event === "toolLoop.forceCompletion"));
  assert.ok(debug.some((entry) => entry.event === "toolLoop.forceFinal"));
});

test("completeWithTools reports denied tool results instead of no answer", async () => {
  const backend = {
    async complete() {
      return { content: 'HACKL_TOOL {"name":"search_files","query":"emoji"}' };
    },
  };

  const answer = await completeWithTools({
    backend,
    messages: [{ role: "user", content: "find all emojis" }],
    maxToolCalls: 1,
    runTool: async () => ({ ok: false, content: "search_files is only available in Work mode." }),
  });

  assert.equal(answer.content, "I could not complete the request: search_files is only available in Work mode.");
});

test("completeWithTools reports empty model completions", async () => {
  const backend = {
    async complete() {
      return { content: "" };
    },
  };

  const answer = await completeWithTools({
    backend,
    messages: [{ role: "user", content: "hello" }],
    maxToolCalls: 1,
    runTool: async () => ({ ok: true, content: "unused" }),
  });

  assert.equal(answer.content, "I did not receive usable assistant text from the model.");
});

test("completeWithTools does not stream prose-wrapped tool calls", async () => {
  const progress = [];
  const backend = {
    async complete(_messages, options) {
      const content = 'I will inspect first.\nHACKL_TOOL {"name":"read_file","path":"src/a.ts"}';
      options.onDelta({ type: "answer", text: content });
      return { content };
    },
  };

  const answer = await completeWithTools({
    backend,
    messages: [{ role: "user", content: "inspect" }],
    maxToolCalls: 0,
    progress: (event) => progress.push(event),
    runTool: async () => ({ ok: true, content: "unused" }),
  });

  assert.equal(progress.some((event) => event.type === "delta" && /HACKL_TOOL/.test(event.text)), false);
  assert.equal(answer.content, "I will inspect first.");
});

test("completeWithTools stops repeated identical tool calls before a high cap", async () => {
  let calls = 0;
  const backend = {
    async complete() {
      calls += 1;
      return { content: 'HACKL_TOOL {"name":"search_files","query":"emoji"}' };
    },
  };

  const answer = await completeWithTools({
    backend,
    messages: [{ role: "user", content: "search" }],
    maxToolCalls: 48,
    runTool: async () => ({ ok: true, content: "No matches." }),
  });

  assert.equal(calls, 4);
  assert.match(answer.content, /Last tool result/);
});

test("completeWithTools runs a streamed complete tool call without waiting for trailing text", async () => {
  let calls = 0;
  const backend = {
    async complete(_messages, options) {
      calls += 1;
      if (calls === 1) {
        options.onDelta({ type: "answer", text: 'HACKL_TOOL {"name":"read_file","path":"src/a.ts"}' });
        throw new Error("should be interrupted by tool detection");
      }
      return { content: "done" };
    },
  };

  const answer = await completeWithTools({
    backend,
    messages: [{ role: "user", content: "read" }],
    maxToolCalls: 4,
    runTool: async () => ({ ok: true, content: "1: ok" }),
  });

  assert.equal(answer.content, "done");
  assert.equal(calls, 2);
});

test("completeWithTools runs empty-query glob searches instead of rendering them", async () => {
  const progress = [];
  const seen = [];
  const backend = {
    async complete(messages, options) {
      seen.push(messages.map((message) => message.content));
      if (seen.length === 1) {
        const content = 'HACKL_TOOL {"name":"search_files","query":"","glob":"**/*","max_results":50}';
        options.onDelta({ type: "answer", text: content });
        return { content };
      }
      return { content: "I found candidate files." };
    },
  };
  const tools = [];

  const answer = await completeWithTools({
    backend,
    messages: [{ role: "user", content: "do some cleanup chores" }],
    maxToolCalls: 4,
    progress: (event) => progress.push(event),
    runTool: async (request) => {
      tools.push(request);
      return { ok: true, content: "src/a.ts: file name match" };
    },
  });

  assert.equal(progress.some((event) => event.type === "delta" && /HACKL_TOOL/.test(event.text)), false);
  assert.deepEqual(tools, [{ name: "search_files", query: "", glob: "**/*", max_results: 50 }]);
  assert.match(seen[1].at(-1), /HACKL_TOOL_RESULT search_files ok/);
  assert.equal(answer.content, "I found candidate files.");
});
