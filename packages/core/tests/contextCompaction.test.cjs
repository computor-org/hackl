const assert = require("node:assert/strict");
const test = require("node:test");
const {
  compactMessagesIfNeeded,
  safeCompactionThreshold,
} = require("../dist/contextCompaction.js");

test("safeCompactionThreshold leaves a 25 percent context reserve", () => {
  assert.equal(safeCompactionThreshold(131072), 98304);
  assert.equal(safeCompactionThreshold(70912), 53184);
  assert.equal(safeCompactionThreshold(4096), 0);
});

test("compaction uses a tool-free bounded summary and keeps recent turns", async () => {
  const calls = [];
  const messages = historyWithLargeOldTurn();
  const result = await compactMessagesIfNeeded({
    backend: {
      async complete(summaryMessages, options) {
        calls.push({ summaryMessages, options });
        return { content: "Observed src/a.ts and verified the remaining task." };
      },
    },
    messages,
    maxContextTokens: 8192,
    compactions: 0,
    keepTurns: 1,
  });

  assert.equal(result.compacted, true);
  assert.equal(result.fallback, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].summaryMessages.length, 2);
  assert.equal(calls[0].options.maxOutputTokens, 4096);
  assert.equal(calls[0].options.enableThinking, false);
  assert.match(result.messages[2].content, /CONTEXT CHECKPOINT/);
  assert.match(result.messages.at(-1).content, /recent observation/);
  assert.ok(result.afterTokens < result.beforeTokens);
});

test("compaction falls back to deterministic evidence when summary fails", async () => {
  const result = await compactMessagesIfNeeded({
    backend: {
      async complete() {
        throw new Error("fake server unavailable");
      },
    },
    messages: historyWithLargeOldTurn(),
    maxContextTokens: 8192,
    compactions: 0,
    keepTurns: 1,
  });

  assert.equal(result.compacted, true);
  assert.equal(result.fallback, true);
  assert.match(result.messages[2].content, /DETERMINISTIC CONTEXT CHECKPOINT/);
  assert.match(result.error, /fake server unavailable/);
});

function historyWithLargeOldTurn() {
  return [
    { role: "system", content: "system" },
    { role: "user", content: "current task" },
    { role: "assistant", content: `HACKL_TOOL ${"old command evidence ".repeat(1800)}` },
    { role: "user", content: `HACKL_TOOL_RESULT run_command ok\n\n${"old output evidence ".repeat(1800)}` },
    { role: "assistant", content: "recent observation" },
  ];
}
