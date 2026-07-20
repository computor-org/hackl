const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const Module = require("node:module");
const test = require("node:test");

test("run_command spawns without a shell in the workspace", async () => {
  let spawnCall;
  await withVscodeStub(vscodeStub(), async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000, allowCommands: true, requestApproval: async () => true,
      spawnImpl: (cmd, args, options) => {
        spawnCall = { cmd, args, options };
        return childStub("ok\n", "", 0);
      } });
    const result = await runTool({ name: "run_command", cmd: "node", args: ["scripts/check.js"] });

    assert.equal(result.ok, true);
    assert.match(result.content, /exit 0/);
    assert.equal(spawnCall.cmd, "node");
    assert.deepEqual(spawnCall.args, ["scripts/check.js"]);
    assert.equal(spawnCall.options.cwd, "/tmp/project");
    assert.equal(spawnCall.options.shell, false);
  });
});

test("run_command blocks hard-denied commands before approval or spawn", async () => {
  let approvals = 0;
  let spawns = 0;
  await withVscodeStub(vscodeStub(), async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000, allowCommands: true,
      requestApproval: async () => { approvals += 1; return true; },
      spawnImpl: () => { spawns += 1; return childStub("", "", 0); } });
    const result = await runTool({ name: "run_command", cmd: "sudo", args: ["npm", "test"] });

    assert.equal(result.ok, false);
    assert.match(result.content, /Blocked command/);
    assert.equal(approvals, 0);
    assert.equal(spawns, 0);
  });
});

test("run_command asks before unknown safe commands", async () => {
  let approvals = 0;
  let spawns = 0;
  await withVscodeStub(vscodeStub(), async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000, allowCommands: true,
      requestApproval: async () => { approvals += 1; return true; },
      spawnImpl: () => { spawns += 1; return childStub("", "", 0); } });
    const result = await runTool({ name: "run_command", cmd: "node", args: ["scripts/check.js"] });

    assert.equal(result.ok, true);
    assert.equal(approvals, 2);
    assert.equal(spawns, 1);
  });
});

test("yolo runs any command through a shell with no policy or approval, and audits it", async () => {
  let approvals = 0;
  let spawnCall;
  let audited;
  await withVscodeStub(vscodeStub(), async () => {
    const { createWorkspaceToolRunner } = freshWorkspaceTools();
    const runTool = createWorkspaceToolRunner({ maxFileChars: 1000, allowCommands: true, yolo: true,
      requestApproval: async () => { approvals += 1; return true; },
      auditCommand: (line) => { audited = line; },
      spawnImpl: (cmd, args, options) => {
        spawnCall = { cmd, args, options };
        return childStub("ok\n", "", 0);
      } });
    // "sudo" is hard-denied outside yolo; a pipe is blocked by the shell-token policy.
    const result = await runTool({ name: "run_command", cmd: "sudo cat /etc/hosts | head", args: [] });

    assert.equal(result.ok, true);
    assert.equal(approvals, 0);
    assert.equal(spawnCall.cmd, "sudo cat /etc/hosts | head");
    assert.equal(spawnCall.options.shell, true);
    assert.match(audited, /yolo run_command: sudo cat \/etc\/hosts \| head/);
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

function vscodeStub() {
  return {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/tmp/project" } }],
      textDocuments: [],
      asRelativePath: (uri) => uri.fsPath.replace("/tmp/project/", ""),
    },
  };
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
