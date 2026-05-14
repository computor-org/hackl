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

test("resolveReviewTargets returns attached context before editor selection", async () => {
  const attached = { id: "attached", kind: "source-range" };
  await withVscode(makeVscode(makeEditor(false)), async () => {
    const { resolveReviewTargets } = freshReviewTargets();
    const result = await resolveReviewTargets({ list: () => [attached] });
    assert.deepEqual(result, [attached]);
  });
});

test("resolveReviewTargets uses selection before current file", async () => {
  await withVscode(makeVscode(makeEditor(false)), async () => {
    const { resolveReviewTargets } = freshReviewTargets();
    const result = await resolveReviewTargets({ list: () => [] });
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, "source-range");
    assert.match(result[0].id, /^src-/);
    assert.equal(result[0].metadata, undefined);
  });
});

test("resolveReviewTargets falls back to current file", async () => {
  await withVscode(makeVscode(makeEditor(true)), async () => {
    const { resolveReviewTargets } = freshReviewTargets();
    const result = await resolveReviewTargets({ list: () => [] });
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, "source-range");
    assert.match(result[0].id, /^file-/);
    assert.equal(result[0].startLine, 1);
    assert.equal(result[0].endLine, 2);
    assert.deepEqual(result[0].metadata, { scope: "current-file" });
  });
});

test("resolveReviewTargets reports missing context", async () => {
  await withVscode(makeVscode(undefined), async () => {
    const { resolveReviewTargets } = freshReviewTargets();
    const result = await resolveReviewTargets({ list: () => [] });
    assert.deepEqual(result, { error: "Select code or attach context first." });
  });
});
