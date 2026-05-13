const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("search_files finds file names and text matches in work mode", async () => {
  const files = [
    documentStub("/tmp/project/src/chatSession.ts", "export class ChatSession {}\n"),
    documentStub("/tmp/project/src/prompt.ts", "const mode = 'work';\n"),
  ];
  const vscode = vscodeStub(files);

  await withVscodeStub(vscode, async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000, allowSearch: true });
    const result = await runTool({ name: "search_files", query: "ChatSession", max_results: 5 });

    assert.equal(result.ok, true);
    assert.match(result.content, /src\/chatSession\.ts: file name match/);
    assert.match(result.content, /src\/chatSession\.ts:1: export class ChatSession/);
  });
});

test("search_files with empty query lists files matched by glob", async () => {
  const files = [
    documentStub("/tmp/project/src/chatSession.ts", "export class ChatSession {}\n"),
    documentStub("/tmp/project/README.md", "# Readme\n"),
  ];
  const vscode = vscodeStub(files);

  await withVscodeStub(vscode, async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000, allowSearch: true });
    const result = await runTool({ name: "search_files", query: "", glob: "**/*", max_results: 5 });

    assert.equal(result.ok, true);
    assert.match(result.content, /src\/chatSession\.ts: file name match/);
    assert.match(result.content, /README\.md: file name match/);
  });
});

test("search_files is rejected outside work mode", async () => {
  await withVscodeStub(vscodeStub([]), async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000 });

    assert.deepEqual(
      await runTool({ name: "search_files", query: "x" }),
      { ok: false, content: "search_files is only available in Work mode." },
    );
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
    if (request === "vscode") return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    await callback();
  } finally {
    Module._load = originalLoad;
  }
}

function vscodeStub(documents) {
  return {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/tmp/project" } }],
      textDocuments: documents,
      asRelativePath: (uri) => uri.fsPath.replace("/tmp/project/", ""),
      findFiles: async () => documents.map((document) => document.uri),
      openTextDocument: async (uri) => documents.find((document) => document.uri.fsPath === uri.fsPath),
    },
  };
}

function documentStub(fileName, text) {
  const lines = text.split("\n");
  return {
    fileName,
    lineCount: lines.length,
    uri: { scheme: "file", fsPath: fileName },
    lineAt: (index) => ({ text: lines[index] || "" }),
  };
}
