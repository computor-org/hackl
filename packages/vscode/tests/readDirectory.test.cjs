const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// The extension host is the real consumer of read_file in Ask and Edit mode;
// a directory has to answer with its entries so the model can name a file.
test("read_file on the workspace folder lists its entries", async () => {
  const project = makeProject();
  const vscode = vscodeStub(project);

  await withVscodeStub(vscode, async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000 });
    const listing = await runTool({ name: "read_file", path: "." });

    assert.equal(listing.ok, true);
    assert.deepEqual(listing.content.split("\n"), ["README.md", "icalc.py", "src/", "test_icalc.py"]);
  });
});

test("read_file on a nested workspace folder lists one level", async () => {
  const project = makeProject();
  const vscode = vscodeStub(project);

  await withVscodeStub(vscode, async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000 });
    const listing = await runTool({ name: "read_file", path: "src" });

    assert.deepEqual(listing.content.split("\n"), ["main.py", "util/"]);
  });
});

function makeProject() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-read-dir-"));
  fs.writeFileSync(path.join(project, "README.md"), "# Readme\n");
  fs.writeFileSync(path.join(project, "icalc.py"), "def add(a, b):\n    return a + b\n");
  fs.writeFileSync(path.join(project, "test_icalc.py"), "def test_add():\n    assert add(1, 2) == 3\n");
  fs.mkdirSync(path.join(project, "src", "util"), { recursive: true });
  fs.writeFileSync(path.join(project, "src", "main.py"), "print('hi')\n");
  fs.mkdirSync(path.join(project, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(project, "node_modules", "dep.js"), "vendored\n");
  return project;
}

function freshWorkspaceTools() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/packages/core/dist/") || key.endsWith("/dist/workspaceTools.js")) {
      delete require.cache[key];
    }
  }
  return require("../dist/workspaceTools.js");
}

function vscodeStub(root) {
  return {
    Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: root } }],
      textDocuments: [],
      asRelativePath: (uri) => path.relative(root, uri.fsPath),
      findFiles: async () => [],
      openTextDocument: async () => undefined,
    },
  };
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
