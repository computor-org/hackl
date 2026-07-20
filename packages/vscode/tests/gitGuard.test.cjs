const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("replace_text asks before writing outside a git repository", async () => {
  let approvals = 0;
  const document = documentStub("const x = 1;\n");
  await withVscodeStub(vscodeStub(document), async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({
      maxFileChars: 1000,
      allowEdits: true,
      requestApproval: async () => {
        approvals += 1;
        return false;
      },
    });
    assert.deepEqual(
      await runTool({ name: "replace_text", path: "src/a.ts", old_text: "1", new_text: "2" }),
      { ok: false, content: "Action cancelled because the workspace is not a Git repository." },
    );
    assert.equal(approvals, 1);
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
    if (request === "vscode") return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    await callback();
  } finally {
    Module._load = originalLoad;
  }
}

function vscodeStub(document) {
  class Range { constructor(start, end) { this.start = start; this.end = end; } }
  return {
    Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) },
    Range,
    WorkspaceEdit: class { replace(uri, range, text) { this.replacement = { uri, range, text }; } },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/tmp/project" } }],
      textDocuments: [document],
      asRelativePath: (uri) => uri.fsPath.replace("/tmp/project/", ""),
      openTextDocument: async () => document,
    },
  };
}

function documentStub(text) {
  return {
    fileName: "/tmp/project/src/a.ts",
    text,
    uri: { scheme: "file", fsPath: "/tmp/project/src/a.ts" },
    getText() { return this.text; },
    positionAt(offset) { return { offset }; },
  };
}
