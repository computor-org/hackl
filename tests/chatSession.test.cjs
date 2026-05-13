const assert = require("node:assert/strict");
const test = require("node:test");
const { ChatSession } = require("../dist/chatSession");

test("ChatSession sends prompt with previous history and records the answer", async () => {
  const calls = [];
  const posted = [];
  const session = new ChatSession(async (prompt, history) => {
    calls.push({ prompt, history });
    return "answer";
  });

  await session.handle({ type: "prompt", prompt: " first " }, (message) => {
    posted.push(message);
    return Promise.resolve(true);
  });
  await session.handle({ type: "prompt", prompt: "second" }, (message) => {
    posted.push(message);
    return Promise.resolve(true);
  });

  assert.deepEqual(calls, [
    { prompt: "first", history: [] },
    {
      prompt: "second",
      history: [
        { role: "user", content: "first" },
        { role: "assistant", content: "answer" },
      ],
    },
  ]);
  assert.deepEqual(posted.map((message) => message.type), ["status", "answer", "status", "answer"]);
});

test("ChatSession replays and clears history", async () => {
  const posted = [];
  const session = new ChatSession(async () => "answer");
  const post = (message) => {
    posted.push(message);
    return Promise.resolve(true);
  };

  await session.handle({ type: "prompt", prompt: "question" }, post);
  await session.handle({ type: "ready" }, post);
  await session.handle({ type: "clear" }, post);
  await session.handle({ type: "ready" }, post);

  assert.deepEqual(posted.at(2), {
    type: "history",
    entries: [
      { role: "user", content: "question" },
      { role: "assistant", content: "answer" },
    ],
  });
  assert.deepEqual(posted.at(3), { type: "cleared" });
  assert.deepEqual(posted.at(4), { type: "history", entries: [] });
});

test("ChatSession reports errors without keeping failed user prompts", async () => {
  const posted = [];
  const session = new ChatSession(async () => {
    throw new Error("backend failed");
  });
  const post = (message) => {
    posted.push(message);
    return Promise.resolve(true);
  };

  await session.handle({ type: "prompt", prompt: "question" }, post);
  await session.handle({ type: "ready" }, post);

  assert.deepEqual(posted, [
    { type: "status", text: "Thinking..." },
    { type: "error", text: "backend failed" },
    { type: "history", entries: [] },
  ]);
});
