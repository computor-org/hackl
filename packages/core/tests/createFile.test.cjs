const assert = require("node:assert/strict");
const test = require("node:test");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runHacklPrompt } = require("../dist/session.js");
const { createNodeWorkspaceHost } = require("../dist/nodeWorkspaceHost.js");
const { createWorkspaceToolRunner } = require("../dist/toolRunner.js");
const { parseToolRequest, BUILTIN_TOOL_NAMES } = require("../dist/tools.js");

// No built-in tool could make a new file, so a work-mode request for one ended
// up appended to an existing file (issue #33).
async function withProject(callback) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hackl-create-"));
  await fsp.mkdir(path.join(root, ".git"));
  await fsp.writeFile(path.join(root, "icalc.py"), "def add(a, b):\n    return a + b\n");
  try {
    return await callback(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

function editRunner(root) {
  return createWorkspaceToolRunner({
    maxFileChars: 12000,
    allowEdits: true,
    allowSearch: true,
    workspace: createNodeWorkspaceHost(root),
  });
}

test("create_file writes a new file with its content unchanged", async () => {
  await withProject(async (root) => {
    const content = "def test_subtract():\n    assert subtract(3, 1) == 2\n";
    const result = await editRunner(root)({ name: "create_file", path: "test_subtract.py", content });

    assert.equal(result.ok, true);
    assert.equal(await fsp.readFile(path.join(root, "test_subtract.py"), "utf8"), content);
  });
});

test("create_file creates the missing parent folders inside the workspace", async () => {
  await withProject(async (root) => {
    const result = await editRunner(root)({ name: "create_file", path: "tests/unit/test_sub.py", content: "x\n" });

    assert.equal(result.ok, true);
    assert.equal(await fsp.readFile(path.join(root, "tests/unit/test_sub.py"), "utf8"), "x\n");
  });
});

test("create_file refuses an existing file and keeps its content", async () => {
  await withProject(async (root) => {
    const result = await editRunner(root)({ name: "create_file", path: "icalc.py", content: "gone\n" });

    assert.equal(result.ok, false);
    assert.match(result.content, /already exists/);
    assert.equal(await fsp.readFile(path.join(root, "icalc.py"), "utf8"), "def add(a, b):\n    return a + b\n");
  });
});

test("a missing file is reported as missing, not as outside the workspace", async () => {
  await withProject(async (root) => {
    const runTool = editRunner(root);
    const read = await runTool({ name: "read_file", path: "test_subtract.py" });
    const replace = await runTool({
      name: "replace_text",
      path: "nested/test_subtract.py",
      old_text: "x",
      new_text: "y",
    });

    assert.equal(read.ok, false);
    assert.match(read.content, /File does not exist: test_subtract\.py/);
    assert.doesNotMatch(read.content, /outside the current workspace/);
    assert.equal(replace.ok, false);
    assert.match(replace.content, /File does not exist: nested\/test_subtract\.py/);
    assert.doesNotMatch(replace.content, /outside the current workspace/);
  });
});

test("create_file still refuses paths that leave the workspace", async () => {
  await withProject(async (root) => {
    const runTool = editRunner(root);
    const relative = await runTool({ name: "create_file", path: "../outside.py", content: "x\n" });
    const absolute = await runTool({ name: "create_file", path: path.join(os.tmpdir(), "hackl-outside.py"), content: "x\n" });

    for (const result of [relative, absolute]) {
      assert.equal(result.ok, false);
      assert.match(result.content, /outside the current workspace/);
    }
    await assert.rejects(fsp.stat(path.join(path.dirname(root), "outside.py")));
  });
});

test("create_file refuses through a symlinked parent folder that leaves the workspace", async () => {
  await withProject(async (root) => {
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "hackl-outside-"));
    await fsp.symlink(outside, path.join(root, "link"));
    const result = await editRunner(root)({ name: "create_file", path: "link/new.py", content: "x\n" });

    assert.equal(result.ok, false);
    assert.match(result.content, /outside the current workspace/);
    await assert.rejects(fsp.stat(path.join(outside, "new.py")));
    await fsp.rm(outside, { recursive: true, force: true });
  });
});

test("create_file is refused in ask mode", async () => {
  await withProject(async (root) => {
    const runTool = createWorkspaceToolRunner({
      maxFileChars: 12000,
      workspace: createNodeWorkspaceHost(root),
    });
    const result = await runTool({ name: "create_file", path: "test_subtract.py", content: "x\n" });

    assert.equal(result.ok, false);
    assert.match(result.content, /only available in Edit, Work, Agent, and Yolo mode/);
    await assert.rejects(fsp.stat(path.join(root, "test_subtract.py")));
  });
});

test("create_file is parsed as a built-in tool and keeps the file content verbatim", () => {
  const request = parseToolRequest('HACKL_TOOL {"name":"create_file","path":"test_subtract.py","content":"x\\n\\ty\\n"}');

  assert.deepEqual(request, {
    name: "create_file",
    path: "test_subtract.py",
    content: "x\n\ty\n",
  });
  assert.equal(BUILTIN_TOOL_NAMES.has("create_file"), true);
  assert.deepEqual(parseToolRequest('HACKL_TOOL {"name":"create_file","path":"a.py"}'), undefined);
});

test("work mode edits a file and creates a new one in one turn", async () => {
  await withProject(async (root) => {
    const replies = [
      'HACKL_TOOL {"name":"replace_text","path":"icalc.py","old_text":"    return a + b\\n","new_text":"    return a + b\\n\\ndef subtract(a, b):\\n    return a - b\\n"}',
      'HACKL_TOOL {"name":"create_file","path":"test_subtract.py","content":"from icalc import subtract\\n\\ndef test_subtract():\\n    assert subtract(3, 1) == 2\\n"}',
      "added subtract() and test_subtract.py",
    ];
    const answer = await runHacklPrompt(
      {
        backend: { async complete() { return { content: replies.shift() }; } },
        workspace: createNodeWorkspaceHost(root),
        config: { maxToolFileChars: 12000, maxContextTokens: 8192 },
      },
      {
        prompt: "Add a function subtract(a, b) to icalc.py and add a new file test_subtract.py containing a pytest test for it.",
        contextText: "",
        mode: "work",
        maxToolCalls: 3,
      },
      () => {},
    );

    assert.equal(answer.content, "added subtract() and test_subtract.py");
    assert.match(await fsp.readFile(path.join(root, "icalc.py"), "utf8"), /def subtract\(a, b\):/);
    assert.match(await fsp.readFile(path.join(root, "test_subtract.py"), "utf8"), /def test_subtract\(\):/);
  });
});

for (const mode of ["edit", "work", "agent", "yolo"]) {
  test(`${mode} mode instructions offer create_file`, async () => {
    const { buildHacklMessages } = require("../dist/prompt.js");
    const system = buildHacklMessages("do it", "", [], mode)[0].content;

    assert.match(system, /"name":"create_file"/);
  });
}
