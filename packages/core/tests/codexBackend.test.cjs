const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");

const { createCodexAppServerBackend, messagesToCodexInput } = require("../dist/codexBackend.js");

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdoutCb = null;
  child.stderrCb = null;
  child.stdin = {
    writes: [],
    write(line) { this.writes.push(line); },
  };
  child.stdout = {
    setEncoding() {},
    on(event, cb) { if (event === "data") child.stdoutCb = cb; },
  };
  child.stderr = {
    setEncoding() {},
    on() {},
  };
  child.kill = () => undefined;
  return child;
}

function fakeSpawn() {
  const created = [];
  function spawn() {
    const child = makeFakeChild();
    created.push(child);
    return child;
  }
  spawn.created = created;
  return spawn;
}

function feed(child, frame) {
  child.stdoutCb(JSON.stringify(frame) + "\n");
}

function reads(child) {
  return child.stdin.writes.map((line) => JSON.parse(line));
}

test("messagesToCodexInput flattens system/assistant/user messages", () => {
  const result = messagesToCodexInput([
    { role: "system", content: "be brief" },
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
    { role: "user", content: "again" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "text");
  assert.ok(result[0].text.includes("[system]"));
  assert.ok(result[0].text.includes("[assistant previous turn]"));
  assert.ok(result[0].text.includes("again"));
});

test("CodexBackend issues initialize, thread/start, turn/start and streams deltas", async () => {
  const spawnImpl = fakeSpawn();
  const backend = createCodexAppServerBackend({ command: "codex", model: "gpt-5-codex", spawnImpl });
  const deltas = [];
  const completionPromise = backend.complete(
    [{ role: "user", content: "hi" }],
    { onDelta: (d) => deltas.push(d) },
  );
  // wait for child to start and initialize/thread/start/turn/start frames
  await Promise.resolve();
  const child = spawnImpl.created[0];
  // Drain frames the backend sent. We must respond to each request id.
  function drain() { return reads(child); }
  // The backend writes initialize first.
  await new Promise((r) => setImmediate(r));
  let frames = drain();
  const init = frames.find((f) => f.method === "initialize");
  assert.ok(init, "initialize sent");
  feed(child, { jsonrpc: "2.0", id: init.id, result: { userAgent: "test" } });
  // After init, an `initialized` notification is sent, then thread/start.
  await new Promise((r) => setImmediate(r));
  frames = drain();
  assert.ok(frames.find((f) => f.method === "initialized" && f.id === undefined), "initialized notification");
  const threadStart = frames.find((f) => f.method === "thread/start");
  assert.ok(threadStart, "thread/start sent");
  assert.equal(threadStart.params.model, "gpt-5-codex");
  feed(child, { jsonrpc: "2.0", id: threadStart.id, result: { thread: { id: "th_1" } } });
  await new Promise((r) => setImmediate(r));
  frames = drain();
  const turnStart = frames.find((f) => f.method === "turn/start");
  assert.ok(turnStart, "turn/start sent");
  assert.equal(turnStart.params.threadId, "th_1");
  assert.equal(turnStart.params.input[0].type, "text");
  feed(child, { jsonrpc: "2.0", id: turnStart.id, result: { turn: { id: "tu_1" } } });
  feed(child, { jsonrpc: "2.0", method: "item/agentMessage/delta", params: { threadId: "th_1", delta: "Hello" } });
  feed(child, { jsonrpc: "2.0", method: "item/agentMessage/delta", params: { threadId: "th_1", delta: " world" } });
  feed(child, { jsonrpc: "2.0", method: "item/reasoning/textDelta", params: { threadId: "th_1", delta: "thinking" } });
  feed(child, { jsonrpc: "2.0", method: "turn/completed", params: { threadId: "th_1" } });
  const completion = await completionPromise;
  assert.equal(completion.content, "Hello world");
  assert.equal(completion.reasoning, "thinking");
  assert.deepEqual(deltas.map((d) => d.type), ["answer", "answer", "reasoning"]);
});

test("CodexBackend surfaces JSON-RPC errors", async () => {
  const spawnImpl = fakeSpawn();
  const backend = createCodexAppServerBackend({ command: "codex", model: "gpt-5-codex", spawnImpl });
  const completionPromise = backend.complete([{ role: "user", content: "hi" }]);
  await new Promise((r) => setImmediate(r));
  const child = spawnImpl.created[0];
  const init = reads(child).find((f) => f.method === "initialize");
  feed(child, { jsonrpc: "2.0", id: init.id, result: {} });
  await new Promise((r) => setImmediate(r));
  const threadStart = reads(child).find((f) => f.method === "thread/start");
  feed(child, { jsonrpc: "2.0", id: threadStart.id, error: { code: -32000, message: "bad model" } });
  await assert.rejects(completionPromise, /bad model/);
});

test("CodexBackend interrupts on abort", async () => {
  const spawnImpl = fakeSpawn();
  const backend = createCodexAppServerBackend({ command: "codex", model: "gpt-5-codex", spawnImpl });
  const controller = new AbortController();
  const completionPromise = backend.complete([{ role: "user", content: "hi" }], { signal: controller.signal });
  await new Promise((r) => setImmediate(r));
  const child = spawnImpl.created[0];
  const init = reads(child).find((f) => f.method === "initialize");
  feed(child, { jsonrpc: "2.0", id: init.id, result: {} });
  await new Promise((r) => setImmediate(r));
  const threadStart = reads(child).find((f) => f.method === "thread/start");
  feed(child, { jsonrpc: "2.0", id: threadStart.id, result: { thread: { id: "th_1" } } });
  await new Promise((r) => setImmediate(r));
  controller.abort();
  await assert.rejects(completionPromise, /Cancelled/);
  const sent = reads(child);
  assert.ok(sent.find((f) => f.method === "turn/interrupt"), "turn/interrupt sent on abort");
});
