const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const EventEmitter = require("node:events");
const test = require("node:test");
const { buildHacklMessages } = require("@hackl/core/prompt");
const { completeWithTools } = require("@hackl/core/toolLoop");
const { createNodeWorkspaceHost, createWorkspaceToolRunner } = require("../dist/workspaceTools.js");

test("ask mode reads a sandbox file and returns a final answer", async () => {
  const sandbox = makeSandbox();
  fs.writeFileSync(path.join(sandbox, "a.txt"), "alpha\nbeta\n");
  const answer = await runModeScenario(sandbox, "ask", [
    'HACKL_TOOL {"name":"read_file","path":"a.txt","start_line":1,"end_line":2}',
    "saw beta",
  ]);

  assert.equal(answer.content, "saw beta");
});

test("edit mode writes through the sandbox node workspace adapter", async () => {
  const sandbox = makeSandbox();
  fs.writeFileSync(path.join(sandbox, "a.txt"), "alpha\n");
  const answer = await runModeScenario(sandbox, "edit", [
    'HACKL_TOOL {"name":"replace_text","path":"a.txt","old_text":"alpha","new_text":"beta"}',
    "changed a.txt",
  ]);

  assert.equal(answer.content, "changed a.txt");
  assert.equal(fs.readFileSync(path.join(sandbox, "a.txt"), "utf8"), "beta\n");
});

test("work mode searches, edits, rejects commands, and still answers", async () => {
  const sandbox = makeSandbox();
  fs.writeFileSync(path.join(sandbox, "a.txt"), "needle alpha\n");
  const spawns = [];
  const answer = await runModeScenario(sandbox, "work", [
    'HACKL_TOOL {"name":"search_files","query":"needle","glob":"**/*","max_results":5}',
    'HACKL_TOOL {"name":"replace_text","path":"a.txt","old_text":"alpha","new_text":"beta"}',
    'HACKL_TOOL {"name":"run_command","cmd":"node","args":["check.js"]}',
    "work done; command unavailable",
  ], { spawns });

  assert.equal(answer.content, "work done; command unavailable");
  assert.equal(fs.readFileSync(path.join(sandbox, "a.txt"), "utf8"), "needle beta\n");
  assert.deepEqual(spawns, []);
});

test("work mode finds emoji lines from the regex-style queries real models use", async () => {
  const sandbox = makeSandbox();
  fs.writeFileSync(path.join(sandbox, "a.txt"), "hello 😀\n");
  fs.mkdirSync(path.join(sandbox, "src"), { recursive: true });
  fs.writeFileSync(path.join(sandbox, "src/app.ts"), "export const label = \"done ✅\";\n");
  const answer = await runModeScenario(sandbox, "work", [
    'HACKL_TOOL {"name":"search_files","query":"[\\\\u{1F600}-\\\\u{1F64F}]|[\\\\u{2700}-\\\\u{27BF}]","glob":"**/*","max_results":5}',
    "found emoji lines",
  ]);

  assert.equal(answer.content, "found emoji lines");
});

test("file tools reject symlinks escaping the workspace", async () => {
  const sandbox = makeSandbox();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret\n");
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(sandbox, "linked.txt"));
  const runTool = createWorkspaceToolRunner({
    maxFileChars: 1000,
    allowSearch: true,
    workspace: createNodeWorkspaceHost(sandbox),
  });

  assert.deepEqual(
    await runTool({ name: "read_file", path: "linked.txt" }),
    { ok: false, content: "Path is outside the current workspace or cannot be resolved." },
  );
});

test("file tools reject binary and oversized files", async () => {
  const sandbox = makeSandbox();
  fs.writeFileSync(path.join(sandbox, "binary.bin"), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(sandbox, "large.txt"), Buffer.alloc(1_000_001, "a"));
  const runTool = createWorkspaceToolRunner({
    maxFileChars: 1000,
    workspace: createNodeWorkspaceHost(sandbox),
  });

  assert.deepEqual(
    await runTool({ name: "read_file", path: "binary.bin" }),
    { ok: false, content: "Binary files are not available to Hackl tools." },
  );
  const large = await runTool({ name: "read_file", path: "large.txt" });
  assert.equal(large.ok, false);
  assert.match(large.content, /File is too large/);
});

test("agent mode can run an approved safe command in the sandbox", async () => {
  const sandbox = makeSandbox();
  const approvals = [];
  const spawns = [];
  const answer = await runModeScenario(sandbox, "agent", [
    'HACKL_TOOL {"name":"run_command","cmd":"node","args":["scripts/check.js"]}',
    "agent verified",
  ], { approvals, spawns });

  assert.equal(answer.content, "agent verified");
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].title, "Run command?");
  assert.deepEqual(spawns.map((call) => [call.cmd, call.args]), [["node", ["scripts/check.js"]]]);
});

async function runModeScenario(sandbox, mode, completions, state = {}) {
  const backend = {
    async complete(messages, options) {
      const content = completions.shift();
      assert.ok(content, "backend called more times than expected");
      options.onDelta({ type: "answer", text: content });
      return { content };
    },
  };
  const runTool = createWorkspaceToolRunner({
    maxFileChars: 1000,
    allowEdits: mode === "edit" || mode === "work" || mode === "agent",
    allowSearch: mode === "work" || mode === "agent",
    allowCommands: mode === "agent",
    requestApproval: async (request) => {
      state.approvals?.push(request);
      return true;
    },
    spawnImpl: (cmd, args, options) => {
      state.spawns?.push({ cmd, args, options });
      return childStub("ok\n", "", 0);
    },
    workspace: createNodeWorkspaceHost(sandbox, (cmd, args, options) => {
      if (cmd === "rg") {
        return failingChild();
      }
      return childStub("", "", 0);
    }),
  });

  const answer = await completeWithTools({
    backend,
    messages: buildHacklMessages("do it", "", [], mode),
    runTool,
    maxToolCalls: 8,
  });
  assert.equal(completions.length, 0, "not all scripted tool calls were consumed");
  return answer;
}

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-mode-"));
  fs.mkdirSync(path.join(dir, ".git"));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.writeFileSync(path.join(dir, "scripts/check.js"), "console.log('ok')\n");
  return dir;
}

function childStub(stdout, stderr, code) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.exitCode = null;
  child.kill = () => { child.killed = true; };
  process.nextTick(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.exitCode = code;
    child.emit("close", code);
  });
  return child;
}

function failingChild() {
  return childStub("", "rg unavailable", 1);
}
