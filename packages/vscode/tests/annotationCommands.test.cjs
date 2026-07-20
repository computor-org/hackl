const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

function makeVscodeStub() {
  return {
    Range: function Range(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; },
    Uri: { parse: (s) => ({ toString: () => s, fsPath: s.replace("file://", "") }) },
    workspace: {
      openTextDocument: async (uri) => ({
        languageId: "typescript",
        lineCount: 5,
        lineAt: (n) => ({ text: `line ${n + 1}` }),
        getText: () => "code",
      }),
      asRelativePath: (uri) => "x.ts",
    },
  };
}

function withVscode(vscode, callback) {
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") return vscode;
    return original.call(this, request, parent, isMain);
  };
  return Promise.resolve(callback()).finally(() => { Module._load = original; });
}

test("handleAnnotationReply adds a basket target and registers a human annotation", async () => {
  const vsc = makeVscodeStub();
  let addedTarget;
  let humanText;
  const basket = {
    add: (t) => { addedTarget = t; },
    list: () => [],
    remove: () => undefined,
  };
  const annotationController = {
    registerHumanComment: (_t, text) => { humanText = text; return { id: "ann-1" }; },
    disposeThread: () => undefined,
  };
  const thread = {
    uri: { toString: () => "file:///x.ts" },
    range: { start: { line: 3, character: 0 }, end: { line: 3, character: 4 } },
  };
  const reply = { thread, text: " please clarify  " };
  await withVscode(vsc, async () => {
    delete require.cache[require.resolve("../dist/annotationCommands.js")];
    delete require.cache[require.resolve("../dist/basket.js")];
    const { handleAnnotationReply } = require("../dist/annotationCommands.js");
    await handleAnnotationReply(reply, basket, annotationController);
  });
  assert.ok(addedTarget, "expected basket.add to be called");
  assert.equal(addedTarget.kind, "source-range");
  assert.equal(addedTarget.metadata && addedTarget.metadata.note, "please clarify");
  assert.equal(humanText, "please clarify");
});

test("handleAnnotationReply ignores empty replies", async () => {
  const vsc = makeVscodeStub();
  let called = false;
  await withVscode(vsc, async () => {
    delete require.cache[require.resolve("../dist/annotationCommands.js")];
    const { handleAnnotationReply } = require("../dist/annotationCommands.js");
    await handleAnnotationReply(
      { thread: { uri: { toString: () => "x" }, range: { start: {line:0}, end: {line:0} } }, text: "   " },
      { add: () => { called = true; }, list: () => [], remove: () => undefined },
      { registerHumanComment: () => { called = true; }, disposeThread: () => undefined },
    );
  });
  assert.equal(called, false);
});

test("handleResolveAnnotationThread resolves and removes thread basket targets", async () => {
  const vsc = makeVscodeStub();
  const removed = [];
  const thread = {
    uri: { toString: () => "file:///x.ts" },
    range: { start: { line: 3, character: 0 }, end: { line: 3, character: 4 } },
  };
  const basket = {
    add: () => undefined,
    list: () => [
      { id: "keep", metadata: { threadKey: "file:///x.ts#1-1" } },
      { id: "drop", metadata: { threadKey: "file:///x.ts#4-4" } },
    ],
    remove: (id) => { removed.push(id); },
  };
  let resolvedThread;
  await withVscode(vsc, async () => {
    delete require.cache[require.resolve("../dist/annotationCommands.js")];
    const { handleResolveAnnotationThread } = require("../dist/annotationCommands.js");
    const n = handleResolveAnnotationThread(thread, basket, {
      resolveThread: (t) => {
        resolvedThread = t;
        return 2;
      },
    });
    assert.equal(n, 2);
  });
  assert.deepEqual(removed, ["drop"]);
  assert.equal(resolvedThread, thread);
});
