const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

test("replace_text applies one exact workspace edit and saves", async () => {
  const project = makeProject("const x = 1;\n");
  const applied = [];
  const document = documentStub(path.join(project, "src/a.ts"), "const x = 1;\n");
  const vscode = vscodeStub(project, document, applied);

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
  const project = makeProject("x\nx\n");
  const applied = [];
  const document = documentStub(path.join(project, "src/a.ts"), "x\nx\n");
  const vscode = vscodeStub(project, document, applied);
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
  const project = makeProject("const x = 1;\n");
  const document = documentStub(path.join(project, "src/a.ts"), "const x = 1;\n");
  const vscode = vscodeStub(project, document, []);
  await withVscodeStub(vscode, async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000 });
    assert.deepEqual(
      await runTool({ name: "replace_text", path: "src/a.ts", old_text: "1", new_text: "2" }),
      { ok: false, content: "replace_text is only available in Edit, Work, or Agent mode." },
    );
    assert.equal(document.text, "const x = 1;\n");
  });
});

function freshWorkspaceTools() {
  // Bust the core runner module graph too so its module-level git-approval
  // state resets per test (it moved from workspaceTools into @hackl/core).
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/packages/core/dist/") || key.endsWith("/dist/workspaceTools.js")) {
      delete require.cache[key];
    }
  }
  return require("../dist/workspaceTools.js");
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

function makeProject(text) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-vscode-"));
  fs.mkdirSync(path.join(project, ".git"));
  fs.mkdirSync(path.join(project, "src"));
  fs.writeFileSync(path.join(project, "src/a.ts"), text);
  return project;
}

function vscodeStub(root, document, applied) {
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
      workspaceFolders: [{ uri: { fsPath: root } }],
      textDocuments: [document],
      asRelativePath: (uri) => path.relative(root, uri.fsPath),
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
