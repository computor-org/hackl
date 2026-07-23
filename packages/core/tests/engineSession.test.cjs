const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const core = require("../dist/index.js");

const FIXTURE = path.join(__dirname, "fixtures", "fake-llama-server.cjs");
const ALIAS = "qwen2.5-coder-1.5b-q4";

test("leased host shares one child and stops it after the last release", async () => {
  const setup = await createSetup();
  const host = new core.EngineSessionHost({
    mode: "leased", env: setup.env, manager: setup.engine, leaseTimeoutMs: 500,
  });
  assert.equal(await host.listen(), true);

  const first = await core.EngineSessionLease.acquireExisting({
    kind: "cli", alias: ALIAS, env: setup.env, heartbeatMs: 100,
  });
  setup.engine.setConfig((config) => { config.model = "qwen2.5-coder-3b-q4"; });
  const second = await core.EngineSessionLease.acquireExisting({
    kind: "vscode", alias: ALIAS, env: setup.env, heartbeatMs: 100,
  });
  assert.ok(first);
  assert.ok(second);
  assert.equal(setup.engine.config().model, ALIAS);
  assert.equal(first.status.pid, second.status.pid);
  assert.equal((await core.queryEngineSession(setup.env)).leases, 2);
  await assert.rejects(
    core.EngineSessionLease.acquireExisting({
      kind: "cli", alias: "qwen2.5-coder-3b-q4", env: setup.env,
    }),
    /owned with model/,
  );

  await first.release();
  assert.equal(await health(setup.port), true);
  await second.release();
  await host.waitForClose();
  await waitUntil(async () => !(await health(setup.port)));
  assert.match(fs.readFileSync(setup.events, "utf8"), /^start \d+\nstop \d+\n$/);
});

test("foreground host survives zero leases until explicitly closed", async () => {
  const setup = await createSetup();
  const host = new core.EngineSessionHost({
    mode: "foreground", env: setup.env, manager: setup.engine, leaseTimeoutMs: 100,
  });
  assert.equal(await host.listen(ALIAS), true);
  const lease = await core.EngineSessionLease.acquireExisting({
    kind: "vscode", alias: ALIAS, env: setup.env, heartbeatMs: 50,
  });
  assert.ok(lease);
  await lease.release();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(await health(setup.port), true);
  await host.close();
  await waitUntil(async () => !(await health(setup.port)));
});

test("only the first host binds the per-user session endpoint", async () => {
  const setup = await createSetup();
  const first = new core.EngineSessionHost({ mode: "leased", env: setup.env, manager: setup.engine });
  const second = new core.EngineSessionHost({ mode: "leased", env: setup.env, manager: setup.engine });
  assert.equal(await first.listen(), true);
  assert.equal(await second.listen(), false);
  await first.close();
});

test("missing heartbeats expire an automatic client lease", async () => {
  const setup = await createSetup();
  const host = new core.EngineSessionHost({
    mode: "leased", env: setup.env, manager: setup.engine, leaseTimeoutMs: 150,
  });
  assert.equal(await host.listen(), true);
  const lease = await core.EngineSessionLease.acquireExisting({
    kind: "cli", alias: ALIAS, env: setup.env, heartbeatMs: 10_000,
  });
  assert.ok(lease);
  await host.waitForClose();
  await waitUntil(async () => !(await health(setup.port)));
});

test("failed engine launch cleans up state and the control endpoint", async () => {
  const setup = await createSetup();
  setup.env.HACKL_FAKE_EXIT = "1";
  const host = new core.EngineSessionHost({
    mode: "foreground", env: setup.env, manager: setup.engine,
  });
  await assert.rejects(host.listen(ALIAS), /exited before becoming ready/);
  assert.equal(core.readEngineState(setup.env), undefined);
  assert.equal(await core.queryEngineSession(setup.env), undefined);
});

async function createSetup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-session-"));
  const port = await freePort();
  const events = path.join(root, "events.log");
  fs.writeFileSync(events, "");
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_RUNTIME_DIR: "",
    LLAMACPP_CACHE_ROOT: path.join(root, "models"),
    LLAMACPP_SERVER_BIN: FIXTURE,
    HACKL_FAKE_EVENTS: events,
  };
  const engine = new core.EngineManager(env);
  engine.status = async () => {
    const state = core.readEngineState(env);
    if (!state || !core.isAlive(state.pid)) return { state: "stopped" };
    return {
      state: "running-managed",
      endpoint: `http://127.0.0.1:${state.port}/v1`,
      model: state.model,
      port: state.port,
      pid: state.pid,
    };
  };
  engine.setConfig((config) => {
    config.model = ALIAS;
    config.port = port;
    config.host = "127.0.0.1";
    config.mmproj = "off";
  });
  const model = core.findModel(ALIAS);
  const dir = core.modelCacheDir(model, env);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "test-q4_k_m.gguf"), "fake");
  return { root, port, events, env, engine };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function health(port) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health`)).ok;
  } catch {
    return false;
  }
}

async function waitUntil(check) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("condition did not become true");
}
