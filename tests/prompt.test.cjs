const assert = require("node:assert/strict");
const test = require("node:test");
const { buildHacklMessages } = require("../dist/prompt.js");

test("buildHacklMessages includes system prompt, history, editor context, and request", () => {
  const messages = buildHacklMessages("explain this", "const value = 1;", [
    { role: "user", content: "previous question" },
    { role: "assistant", content: "previous answer" },
  ]);

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /Hackl/);
  assert.match(messages[0].content, /HACKL_TOOL/);
  assert.match(messages[0].content, /No long think/);
  assert.deepEqual(messages.slice(1, 3), [
    { role: "user", content: "previous question" },
    { role: "assistant", content: "previous answer" },
  ]);
  assert.equal(messages[3].role, "user");
  assert.match(messages[3].content, /const value = 1;/);
  assert.match(messages[3].content, /explain this/);
});

test("buildHacklMessages trims history to recent non-empty chat messages", () => {
  const history = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index}`,
  }));

  const messages = buildHacklMessages("current", "", [
    { role: "user", content: " " },
    ...history,
  ]);

  assert.equal(messages.length, 10);
  assert.deepEqual(messages.slice(1, 9).map((message) => message.content), [
    "message 2",
    "message 3",
    "message 4",
    "message 5",
    "message 6",
    "message 7",
    "message 8",
    "message 9",
  ]);
  assert.match(messages[9].content, /\[no editor context\]/);
});
