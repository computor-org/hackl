const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("search_files finds file names and text matches in work mode", async () => {
  const project = makeProject();
  const files = [
    documentStub(path.join(project, "src/chatSession.ts"), "export class ChatSession {}\n"),
    documentStub(path.join(project, "src/prompt.ts"), "const mode = 'work';\n"),
  ];
  const vscode = vscodeStub(project, files);

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
  const project = makeProject();
  const files = [
    documentStub(path.join(project, "src/chatSession.ts"), "export class ChatSession {}\n"),
    documentStub(path.join(project, "README.md"), "# Readme\n"),
  ];
  const vscode = vscodeStub(project, files);

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
  const project = makeProject();
  await withVscodeStub(vscodeStub(project, []), async () => {
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

function makeProject() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-search-"));
  fs.mkdirSync(path.join(project, "src"));
  return project;
}

function vscodeStub(root, documents) {
  for (const document of documents) {
    fs.mkdirSync(path.dirname(document.fileName), { recursive: true });
    fs.writeFileSync(document.fileName, document.text);
  }
  return {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: root } }],
      textDocuments: documents,
      asRelativePath: (uri) => path.relative(root, uri.fsPath),
      findFiles: async () => documents.map((document) => document.uri),
      openTextDocument: async (uri) => documents.find((document) => document.uri.fsPath === uri.fsPath),
    },
  };
}

function documentStub(fileName, text) {
  const lines = text.split("\n");
  return {
    fileName,
    text,
    lineCount: lines.length,
    uri: { scheme: "file", fsPath: fileName },
    lineAt: (index) => ({ text: lines[index] || "" }),
  };
}
