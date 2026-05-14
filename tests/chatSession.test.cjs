const assert = require("node:assert/strict");
const test = require("node:test");
const { ChatSession } = require("../dist/chatSession");

test("ChatSession sends prompt with previous history and records the answer", async () => {
  const calls = [];
  const posted = [];
  const session = new ChatSession(async ({ prompt, history, mode }) => {
    calls.push({ prompt, history, mode });
    return "answer";
  });

  await session.handle({ type: "prompt", prompt: " first ", mode: "work" }, (message) => {
    posted.push(message);
    return Promise.resolve(true);
  });
  await session.handle({ type: "prompt", prompt: "second" }, (message) => {
    posted.push(message);
    return Promise.resolve(true);
  });

  assert.deepEqual(calls, [
    { prompt: "first", history: [], mode: "work" },
    {
      prompt: "second",
      mode: "ask",
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
    { type: "status", text: "Preprocessing..." },
    { type: "error", text: "backend failed" },
    { type: "history", entries: [] },
  ]);
});

test("ChatSession forwards progress, metrics, and reasoning", async () => {
  const posted = [];
  const session = new ChatSession(async ({ progress }) => {
    progress({ type: "phase", text: "Preprocessing 9 ms", inputTokens: 100, maxContextTokens: 1000 });
    progress({ type: "delta", channel: "reasoning", text: "checking" });
    return { content: "answer", reasoning: "checking" };
  });

  await session.handle({ type: "prompt", prompt: "question" }, (message) => {
    posted.push(message);
    return Promise.resolve(true);
  });

  assert.deepEqual(posted, [
    { type: "status", text: "Preprocessing..." },
    { type: "status", text: "Preprocessing 9 ms" },
    { type: "metrics", inputTokens: 100, maxContextTokens: 1000 },
    { type: "assistantDelta", channel: "reasoning", text: "checking" },
    { type: "answer", text: "answer", reasoning: "checking" },
  ]);
});

test("ChatSession resolves inline approval responses", async () => {
  const posted = [];
  const session = new ChatSession(async ({ requestApproval }) => {
    const approved = await requestApproval({ title: "Run command?", detail: "npm test", approveLabel: "Run", denyLabel: "Deny" });
    return approved ? "approved" : "denied";
  });
  const post = (message) => { posted.push(message); return Promise.resolve(true); };
  const pending = session.handle({ type: "prompt", prompt: "test" }, post);
  await new Promise((resolve) => setImmediate(resolve));
  const approval = posted.find((message) => message.type === "approvalRequested");
  assert.ok(approval);
  await session.handle({ type: "approvalResponse", approvalId: approval.id, approved: true }, post);
  await pending;
  assert.deepEqual(posted.map((message) => message.type), ["status", "approvalRequested", "answer"]);
  assert.equal(posted.at(-1).text, "approved");
});
