const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

// The extension host is the real consumer of the file tools in Edit and Work
// mode; a new file has to reach the workspace-edit route instead of being
// reported as outside the workspace (issue #33).
function freshWorkspaceTools() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/packages/core/dist/") || key.endsWith("/dist/workspaceTools.js")) {
      delete require.cache[key];
    }
  }
  return require("../dist/workspaceTools.js");
}

function withVscodeStub(vscode, callback) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return callback();
  } finally {
    Module._load = originalLoad;
  }
}

function makeProject() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-create-vscode-"));
  fs.mkdirSync(path.join(project, ".git"));
  fs.mkdirSync(path.join(project, "src"));
  fs.writeFileSync(path.join(project, "src/a.ts"), "const x = 1;\n");
  return project;
}

function vscodeStub(root, created) {
  class Position {
    constructor(line, character) { this.line = line; this.character = character; }
  }
  class Range {
    constructor(start, end) { this.start = start; this.end = end; }
  }
  class WorkspaceEdit {
    replace(uri, range, text) { this.replacement = { uri, range, text }; }
    createFile(uri, options) { this.creation = { uri, options }; }
  }
  return {
    Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) },
    Position,
    Range,
    WorkspaceEdit,
    workspace: {
      workspaceFolders: [{ uri: { fsPath: root } }],
      textDocuments: [],
      asRelativePath: (uri) => path.relative(root, uri.fsPath),
      findFiles: async () => [],
      openTextDocument: async (uri) => ({
        uri,
        lineCount: 1,
        lineAt: () => ({ text: "" }),
        getText: () => "",
        positionAt: (offset) => new Position(0, offset),
        save: async () => true,
      }),
      applyEdit: async (edit) => {
        const creation = edit.creation;
        created.push(creation);
        fs.mkdirSync(path.dirname(creation.uri.fsPath), { recursive: true });
        if (creation.options.overwrite === false && fs.existsSync(creation.uri.fsPath)) {
          return false;
        }
        fs.writeFileSync(creation.uri.fsPath, creation.options.contents ?? "", "utf8");
        return true;
      },
    },
  };
}

test("create_file makes a new file through the VS Code workspace edit", async () => {
  const project = makeProject();
  const created = [];
  const content = "def test_subtract():\n    assert subtract(3, 1) == 2\n";

  await withVscodeStub(vscodeStub(project, created), async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000, allowEdits: true, requestApproval: async () => true });
    const result = await runTool({ name: "create_file", path: "tests/test_subtract.py", content });

    assert.deepEqual(result, { ok: true, content: "Created tests/test_subtract.py." });
    assert.equal(created.length, 1);
    assert.equal(created[0].options.overwrite, false);
    assert.equal(fs.readFileSync(path.join(project, "tests/test_subtract.py"), "utf8"), content);
  });
});

test("create_file refuses an existing file and keeps its content", async () => {
  const project = makeProject();
  const created = [];

  await withVscodeStub(vscodeStub(project, created), async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000, allowEdits: true, requestApproval: async () => true });
    const result = await runTool({ name: "create_file", path: "src/a.ts", content: "gone\n" });

    assert.equal(result.ok, false);
    assert.match(result.content, /already exists/);
    assert.deepEqual(created, []);
    assert.equal(fs.readFileSync(path.join(project, "src/a.ts"), "utf8"), "const x = 1;\n");
  });
});

test("the extension host names a missing file instead of a workspace violation", async () => {
  const project = makeProject();
  const created = [];

  await withVscodeStub(vscodeStub(project, created), async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000, allowEdits: true, requestApproval: async () => true });
    const read = await runTool({ name: "read_file", path: "src/missing.py" });
    const replace = await runTool({ name: "replace_text", path: "src/missing.py", old_text: "x", new_text: "y" });

    assert.match(read.content, /File does not exist: src\/missing\.py/);
    assert.doesNotMatch(read.content, /outside the current workspace/);
    assert.match(replace.content, /File does not exist: src\/missing\.py/);
    assert.doesNotMatch(replace.content, /outside the current workspace/);
  });
});

test("create_file refuses through a symlinked folder that leaves the workspace", async () => {
  const project = makeProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-outside-"));
  fs.symlinkSync(outside, path.join(project, "link"));
  const created = [];

  await withVscodeStub(vscodeStub(project, created), async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000, allowEdits: true, requestApproval: async () => true });
    const result = await runTool({ name: "create_file", path: "link/new.py", content: "x\n" });

    assert.equal(result.ok, false);
    assert.match(result.content, /outside the current workspace/);
    assert.equal(fs.existsSync(path.join(outside, "new.py")), false);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
