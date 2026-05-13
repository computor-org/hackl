const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("replace_text applies one exact workspace edit and saves", async () => {
  const applied = [];
  const document = documentStub("/tmp/project/src/a.ts", "const x = 1;\n");
  const vscode = vscodeStub(document, applied);

  await withVscodeStub(vscode, async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000, allowEdits: true, requestApproval: async () => true });
    const result = await runTool({
      name: "replace_text",
      path: "src/a.ts",
      old_text: "const x = 1;",
      new_text: "const x = 2;",
    });
    assert.deepEqual(result, { ok: true, content: "Replaced text in src/a.ts." });
    assert.equal(document.text, "const x = 2;\n");
    assert.equal(document.saved, true);
    assert.equal(applied.length, 1);
  });
});

test("replace_text rejects missing or repeated old text", async () => {
  const applied = [];
  const document = documentStub("/tmp/project/src/a.ts", "x\nx\n");
  const vscode = vscodeStub(document, applied);
  await withVscodeStub(vscode, async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000, allowEdits: true, requestApproval: async () => true });
    assert.deepEqual(
      await runTool({ name: "replace_text", path: "src/a.ts", old_text: "x", new_text: "y" }),
      { ok: false, content: "old_text must match exactly once in the file." },
    );
    assert.deepEqual(
      await runTool({ name: "replace_text", path: "src/a.ts", old_text: "z", new_text: "y" }),
      { ok: false, content: "old_text must match exactly once in the file." },
    );
    assert.equal(applied.length, 0);
  });
});

test("replace_text is rejected unless edit mode enables writes", async () => {
  const document = documentStub("/tmp/project/src/a.ts", "const x = 1;\n");
  const vscode = vscodeStub(document, []);
  await withVscodeStub(vscode, async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000 });
    assert.deepEqual(
      await runTool({ name: "replace_text", path: "src/a.ts", old_text: "1", new_text: "2" }),
      { ok: false, content: "replace_text is only available in Edit, Work, Agent, or YOLO mode." },
    );
    assert.equal(document.text, "const x = 1;\n");
  });
});

function freshWorkspaceTools() {
  const path = require.resolve("../dist/workspaceTools.js");
  delete require.cache[path];
  return require(path);
}

async function withVscodeStub(vscode, callback) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") {
      return vscode;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    await callback();
  } finally {
    Module._load = originalLoad;
  }
}

function vscodeStub(document, applied) {
  class Range {
    constructor(start, end) { this.start = start; this.end = end; }
  }
  class WorkspaceEdit {
    replace(uri, range, text) { this.replacement = { uri, range, text }; }
  }
  return {
    Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) },
    Range,
    WorkspaceEdit,
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/tmp/project" } }],
      textDocuments: [document],
      asRelativePath: (uri) => uri.fsPath.replace("/tmp/project/", ""),
      openTextDocument: async () => document,
      applyEdit: async (edit) => {
        const replacement = edit.replacement;
        applied.push(replacement);
        document.text = document.text.slice(0, replacement.range.start.offset)
          + replacement.text
          + document.text.slice(replacement.range.end.offset);
        return true;
      },
    },
  };
}

function documentStub(fileName, text) {
  return {
    fileName,
    text,
    saved: false,
    uri: { scheme: "file", fsPath: fileName },
    getText() { return this.text; },
    positionAt(offset) { return { offset }; },
    save() { this.saved = true; return Promise.resolve(true); },
  };
}
