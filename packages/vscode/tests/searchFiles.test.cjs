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
    assert.doesNotMatch(result.content, /export class ChatSession/);
  });
});

test("search_files skips symlinks that resolve outside the workspace", async () => {
  const project = makeProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-search-outside-"));
  const outsideFile = path.join(outside, "secret.txt");
  const symlinkPath = path.join(project, "leak.txt");
  fs.writeFileSync(outsideFile, "needle\n");
  fs.symlinkSync(outsideFile, symlinkPath);

  const vscode = vscodeStub(project, [
    documentStub(symlinkPath, "needle\n"),
  ]);

  await withVscodeStub(vscode, async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000, allowSearch: true });
    const result = await runTool({ name: "search_files", query: "needle", glob: "**/*", max_results: 5 });

    assert.deepEqual(result, { ok: true, content: "No matches." });
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

function makeProject() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-search-"));
  fs.mkdirSync(path.join(project, "src"));
  return project;
}

function vscodeStub(root, documents) {
  for (const document of documents) {
    fs.mkdirSync(path.dirname(document.fileName), { recursive: true });
    if (!fs.existsSync(document.fileName)) {
      fs.writeFileSync(document.fileName, document.text);
    }
  }
  return {
    Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) },
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
