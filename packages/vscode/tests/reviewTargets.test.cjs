const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

function makeEditor(selectionEmpty) {
  const uri = { toString: () => "file:///repo/src/x.ts" };
  const lines = ["const x = 1;", "const y = 2;"];
  return {
    selection: {
      isEmpty: selectionEmpty,
      start: { line: 0, character: 0 },
      end: { line: 0, character: 10 },
    },
    document: {
      uri,
      languageId: "typescript",
      lineCount: lines.length,
      lineAt: (line) => ({ text: lines[line] }),
      getText: () => lines.join("\n"),
    },
  };
}

function makeVscode(editor) {
  return {
    window: { activeTextEditor: editor },
    workspace: { asRelativePath: () => "src/x.ts" },
    Range: function Range(a, b, c, d) {
      this.start = { line: a, character: b };
      this.end = { line: c, character: d };
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

function freshReviewTargets() {
  for (const file of ["../dist/reviewTargets.js", "../dist/basket.js", "../dist/vscodeShim.js"]) {
    delete require.cache[require.resolve(file)];
  }
  return require("../dist/reviewTargets.js");
}

test("resolveReviewTargets reviews staged changes when present", async () => {
  const staged = { id: "staged", kind: "staged-changes", files: ["a.ts"] };
  await withVscode(makeVscode(makeEditor(false)), async () => {
    const { resolveReviewTargets } = freshReviewTargets();
    const result = await resolveReviewTargets({ list: () => [] }, async () => staged);
    assert.deepEqual(result, [staged]);
  });
});

test("resolveReviewTargets reviews attached context when nothing is staged", async () => {
  const attached = { id: "attached", kind: "source-range" };
  await withVscode(makeVscode(makeEditor(false)), async () => {
    const { resolveReviewTargets } = freshReviewTargets();
    const result = await resolveReviewTargets({ list: () => [attached] }, async () => ({ error: "No staged changes." }));
    assert.deepEqual(result, [attached]);
  });
});

test("resolveReviewTargets reviews staged changes plus attached context", async () => {
  const staged = { id: "staged", kind: "staged-changes", files: ["a.ts"] };
  const attached = { id: "attached", kind: "source-range" };
  await withVscode(makeVscode(makeEditor(false)), async () => {
    const { resolveReviewTargets } = freshReviewTargets();
    const result = await resolveReviewTargets({ list: () => [attached] }, async () => staged);
    assert.deepEqual(result, [staged, attached]);
  });
});

test("resolveReviewTargets falls back to current file", async () => {
  await withVscode(makeVscode(makeEditor(true)), async () => {
    const { resolveReviewTargets } = freshReviewTargets();
    const result = await resolveReviewTargets({ list: () => [] }, async () => ({ error: "No staged changes." }));
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, "source-range");
    assert.match(result[0].id, /^file-/);
    assert.equal(result[0].startLine, 1);
    assert.equal(result[0].endLine, 2);
    assert.deepEqual(result[0].metadata, { scope: "current-file" });
  });
});

test("resolveReviewTargets uses current file instead of selection fallback", async () => {
  await withVscode(makeVscode(makeEditor(false)), async () => {
    const { resolveReviewTargets } = freshReviewTargets();
    const result = await resolveReviewTargets({ list: () => [] }, async () => ({ error: "No staged changes." }));
    assert.equal(result.length, 1);
    assert.match(result[0].id, /^file-/);
    assert.deepEqual(result[0].metadata, { scope: "current-file" });
  });
});

test("resolveReviewTargets reports missing context", async () => {
  await withVscode(makeVscode(undefined), async () => {
    const { resolveReviewTargets } = freshReviewTargets();
    const result = await resolveReviewTargets({ list: () => [] }, async () => ({ error: "No staged changes." }));
    assert.deepEqual(result, { error: "Stage changes, attach context, or open a file first." });
  });
});
