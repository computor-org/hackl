const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

function makeFakeVscode() {
  const disposed = new Set();
  const threads = [];
  function CommentThread(uri, range) {
    this.uri = uri;
    this.range = range;
    this.comments = [];
    this.label = "";
    this.disposed = false;
    this.dispose = () => { this.disposed = true; disposed.add(this); };
    threads.push(this);
  }
  return {
    threads,
    vscode: {
      Uri: { parse: (s) => ({ toString: () => s }) },
      Range: function Range(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; },
      Position: function Position(line, character) { this.line = line; this.character = character; },
      MarkdownString: function MarkdownString(s) { this.value = s; this.isTrusted = false; },
      CommentMode: { Preview: 1, Editing: 0 },
      CommentThreadCollapsibleState: { Expanded: 1, Collapsed: 0 },
      CommentThreadState: { Unresolved: 0, Resolved: 1 },
      comments: {
        createCommentController: () => ({
          createCommentThread: (uri, range) => new CommentThread(uri, range),
          dispose: () => undefined,
        }),
      },
    },
  };
}

function withVscode(vscode, callback) {
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") return vscode;
    return original.call(this, request, parent, isMain);
  };
  try {
    return callback();
  } finally {
    Module._load = original;
  }
}

function freshControllerModule() {
  const p = require.resolve("../dist/annotations.js");
  delete require.cache[p];
  const shim = require.resolve("../dist/vscodeShim.js");
  delete require.cache[shim];
  return require(p);
}

test("AnnotationController.discardLastBatch removes only the most recent batch", () => {
  const fake = makeFakeVscode();
  withVscode(fake.vscode, () => {
    const { AnnotationController } = freshControllerModule();
    const controller = new AnnotationController();

    controller.beginBatch();
    const a = controller.add({ uri: "file:///a.ts", startLine: 1, endLine: 1, severity: "note", message: "a", authorType: "ai" });
    controller.recordBatch([a.id]);

    controller.beginBatch();
    const b1 = controller.add({ uri: "file:///b.ts", startLine: 1, endLine: 1, severity: "note", message: "b1", authorType: "ai" });
    const b2 = controller.add({ uri: "file:///b.ts", startLine: 2, endLine: 2, severity: "note", message: "b2", authorType: "ai" });
    controller.recordBatch([b1.id, b2.id]);

    assert.equal(controller.list().length, 3);
    assert.equal(controller.discardLastBatch(), 2);
    assert.equal(controller.list().length, 1);
    assert.equal(controller.list()[0].message, "a");

    assert.equal(controller.discardLastBatch(), 1);
    assert.equal(controller.list().length, 0);
    assert.equal(controller.discardLastBatch(), 0);
  });
});

test("AnnotationController provides editor line comment ranges with file commenting enabled", () => {
  const fake = makeFakeVscode();
  withVscode(fake.vscode, () => {
    const { AnnotationController } = freshControllerModule();
    const controller = new AnnotationController();
    const provider = controller.controller.commentingRangeProvider;

    const result = provider.provideCommentingRanges({
      uri: { scheme: "file", toString: () => "file:///x.ts" },
      languageId: "typescript",
      lineCount: 42,
    });

    assert.equal(result.enableFileComments, true, "file-level commenting must stay enabled to keep the gutter strip alive");
    assert.equal(Array.isArray(result.ranges), true);
    assert.equal(result.ranges.length, 1);
    assert.deepEqual(result.ranges[0].start, { line: 0, character: 0 });
    assert.deepEqual(result.ranges[0].end, { line: 41, character: 0 });
  });
});

test("AnnotationController disables line ranges for non-text schemes", () => {
  const fake = makeFakeVscode();
  withVscode(fake.vscode, () => {
    const { AnnotationController } = freshControllerModule();
    const controller = new AnnotationController();
    const provider = controller.controller.commentingRangeProvider;

    const result = provider.provideCommentingRanges({
      uri: { scheme: "comment", toString: () => "comment://hackl.annotations/input.md" },
      languageId: "markdown",
      lineCount: 1,
    });

    assert.deepEqual(result.ranges, []);
    assert.equal(result.enableFileComments, true);
  });
});

test("AnnotationController.refreshCommentingRanges keeps the provider stable", () => {
  const fake = makeFakeVscode();
  withVscode(fake.vscode, () => {
    const { AnnotationController } = freshControllerModule();
    const controller = new AnnotationController();
    const first = controller.controller.commentingRangeProvider;
    assert.equal(typeof first.provideCommentingRanges, "function");
    controller.refreshCommentingRanges();
    assert.equal(
      controller.controller.commentingRangeProvider,
      first,
      "refresh must not churn the provider because VS Code disposes focused comment widgets on reassignment",
    );
  });
});

test("AnnotationController.refreshCommentingRanges does not churn after comment focus", () => {
  const fake = makeFakeVscode();
  withVscode(fake.vscode, () => {
    const { AnnotationController } = freshControllerModule();
    const controller = new AnnotationController();
    const before = controller.controller.commentingRangeProvider;
    controller.refreshCommentingRanges();
    assert.equal(controller.controller.commentingRangeProvider, before);
  });
});

test("AnnotationController.refreshCommentingRanges is idempotent", () => {
  const fake = makeFakeVscode();
  withVscode(fake.vscode, () => {
    const { AnnotationController } = freshControllerModule();
    const controller = new AnnotationController();
    controller.refreshCommentingRanges();
    const afterFirst = controller.controller.commentingRangeProvider;
    controller.refreshCommentingRanges();
    assert.equal(
      controller.controller.commentingRangeProvider,
      afterFirst,
      "repeated calls must not churn the provider",
    );
  });
});

test("AnnotationController.add dedupes by location + message + severity + authorType", () => {
  const fake = makeFakeVscode();
  withVscode(fake.vscode, () => {
    const { AnnotationController } = freshControllerModule();
    const controller = new AnnotationController();
    const a = controller.add({ uri: "file:///x.ts", startLine: 5, endLine: 7, severity: "warning", message: "same", authorType: "ai" });
    const b = controller.add({ uri: "file:///x.ts", startLine: 5, endLine: 7, severity: "warning", message: "same", authorType: "ai" });
    assert.match(a.id, /^ann-/);
    assert.equal(a.id, b.id, "duplicate add should return existing annotation");
    assert.equal(controller.list().length, 1);
    const c = controller.add({ uri: "file:///x.ts", startLine: 5, endLine: 7, severity: "warning", message: "different", authorType: "ai" });
    assert.notEqual(a.id, c.id);
    assert.equal(controller.list().length, 2);
  });
});

test("AnnotationController.addBatch records only newly created annotations", () => {
  const fake = makeFakeVscode();
  withVscode(fake.vscode, () => {
    const { AnnotationController } = freshControllerModule();
    const controller = new AnnotationController();
    const first = { uri: "file:///x.ts", startLine: 1, endLine: 1, severity: "note", message: "same", authorType: "ai" };
    const second = { uri: "file:///x.ts", startLine: 2, endLine: 2, severity: "warning", message: "new", authorType: "ai" };

    assert.equal(controller.addBatch([first]).length, 1);
    assert.equal(controller.addBatch([first]).length, 0);
    assert.equal(controller.addBatch([second]).length, 1);
    assert.equal(controller.list().length, 2);

    assert.equal(controller.discardLastBatch(), 1);
    assert.deepEqual(controller.list().map((a) => a.message), ["same"]);
    assert.equal(controller.discardLastBatch(), 1);
    assert.equal(controller.list().length, 0);
  });
});

test("AnnotationController.registerHumanComment uses annotation ids", () => {
  const fake = makeFakeVscode();
  withVscode(fake.vscode, () => {
    const { AnnotationController } = freshControllerModule();
    const controller = new AnnotationController();
    const thread = fake.threads[0] || {
      uri: { toString: () => "file:///x.ts" },
      range: { start: { line: 0 }, end: { line: 0 } },
      comments: [],
      label: "",
    };
    const annotation = controller.registerHumanComment(thread, "note <ok>");
    assert.match(annotation.id, /^ann-/);
    assert.equal(thread.canReply, false);
    assert.match(thread.comments[0].body.value, /note &lt;ok&gt;/);
  });
});

test("AnnotationController renders compact escaped comment bodies", () => {
  const fake = makeFakeVscode();
  withVscode(fake.vscode, () => {
    const { AnnotationController } = freshControllerModule();
    const controller = new AnnotationController();
    controller.add({
      uri: "file:///x.ts",
      startLine: 1,
      endLine: 1,
      severity: "warning",
      message: "mind <this>\nnow",
      rationale: "because & why",
      authorType: "ai",
    });
    const body = fake.threads[0].comments[0].body.value;

    assert.equal(body.includes("\n\n"), false);
    assert.match(body, /mind &lt;this&gt;<br>now/);
    assert.match(body, /<em>because &amp; why<\/em>/);
  });
});

test("AnnotationController.resolveThread marks a thread resolved without disposing it", () => {
  const fake = makeFakeVscode();
  withVscode(fake.vscode, () => {
    const { AnnotationController } = freshControllerModule();
    const controller = new AnnotationController();
    const annotation = controller.add({
      uri: "file:///x.ts",
      startLine: 1,
      endLine: 1,
      severity: "note",
      message: "note",
      authorType: "ai",
    });
    const thread = fake.threads[0];

    assert.equal(controller.resolveThread(thread), 1);
    assert.equal(thread.state, fake.vscode.CommentThreadState.Resolved);
    assert.equal(thread.contextValue, "hackl.annotation.resolved");
    assert.equal(thread.canReply, false);
    assert.equal(thread.disposed, false);
    assert.equal(controller.list().find((item) => item.id === annotation.id).status, "resolved");
  });
});

test("vscodeShim re-resolves the injected vscode on each call", () => {
  const a = makeFakeVscode();
  const b = makeFakeVscode();
  const shim = require.resolve("../dist/vscodeShim.js");
  delete require.cache[shim];
  const { getVscode } = require(shim);
  withVscode(a.vscode, () => {
    assert.equal(getVscode(), a.vscode);
  });
  withVscode(b.vscode, () => {
    assert.equal(getVscode(), b.vscode);
  });
});
