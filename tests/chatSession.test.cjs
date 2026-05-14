const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ChatSession,
  DEFAULT_ANNOTATION_PROMPT,
  DEFAULT_REVIEW_PROMPT,
  parseSlashCommand,
} = require("../dist/chatSession");

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

test("ChatSession accepts empty prompts when annotations are requested", async () => {
  const calls = [];
  const posted = [];
  const session = new ChatSession(async ({ prompt, options }) => {
    calls.push({ prompt, createAnnotations: options.createAnnotations });
    return "answer";
  });

  await session.handle({ type: "prompt", prompt: "   ", createAnnotations: true }, (message) => {
    posted.push(message);
    return Promise.resolve(true);
  });

  assert.deepEqual(calls, [{ prompt: DEFAULT_ANNOTATION_PROMPT, createAnnotations: true }]);
  assert.deepEqual(posted.map((message) => message.type), ["status", "answer"]);
});

test("parseSlashCommand recognizes only exact review command", () => {
  assert.deepEqual(parseSlashCommand("/review"), {
    kind: "review",
    prompt: DEFAULT_REVIEW_PROMPT,
    createAnnotations: true,
    forceMode: "ask",
  });
  assert.equal(parseSlashCommand("  /review  ").kind, "review");
  assert.deepEqual(parseSlashCommand("review this"), {
    kind: "freeform",
    prompt: "review this",
    createAnnotations: false,
  });
  assert.deepEqual(parseSlashCommand("/review file"), {
    kind: "freeform",
    prompt: "/review file",
    createAnnotations: false,
  });
});

test("ChatSession /review forces Ask mode and annotations", async () => {
  const calls = [];
  const target = { id: "src", kind: "source-range" };
  const posted = [];
  const session = new ChatSession(
    async ({ prompt, mode, options, targets }) => {
      calls.push({ prompt, mode, createAnnotations: options.createAnnotations, targets });
      return "answer";
    },
    undefined,
    async () => [target],
  );

  await session.handle({ type: "prompt", prompt: "/review", mode: "agent", createAnnotations: false }, (message) => {
    posted.push(message);
    return Promise.resolve(true);
  });

  assert.deepEqual(calls, [{
    prompt: DEFAULT_REVIEW_PROMPT,
    mode: "ask",
    createAnnotations: true,
    targets: [target],
  }]);
  assert.deepEqual(posted.map((message) => message.type), ["status", "answer"]);
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
