const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { WebSocket } = require("ws");
const { sessionEndpoint } = require("@hackl/core");

const CLI = path.join(__dirname, "..", "dist", "index.js");
const STUB_MODEL = "stub-chat-model";
const STUB_ANSWER = "stub answer";
// Nothing may reach the network from these tests: a download attempt dies here.
const DEAD_PROXY = "http://127.0.0.1:1";

function listen(server, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve(server.address().port));
  });
}

// Minimal OpenAI-compatible endpoint: model list, context probe, one streamed turn.
async function startStubServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];
    requests.push(`${req.method} ${url}`);
    const json = (body) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (url === "/v1/models") return json({ data: [{ id: STUB_MODEL, n_ctx: 4096 }] });
    if (url === "/v1/props" || url === "/props") return json({ n_ctx: 4096 });
    if (url === "/v1/chat/completions") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const payload = JSON.parse(body || "{}");
        requests.push(`model:${payload.model}`);
        requests.push(`auth:${req.headers.authorization ?? ""}`);
        res.setHeader("content-type", "text/event-stream");
        res.write(`data: ${JSON.stringify({ model: STUB_MODEL, choices: [{ index: 0, delta: { role: "assistant", content: STUB_ANSWER } }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  const port = await listen(server);
  return { server, port, endpoint: `http://127.0.0.1:${port}/v1`, requests };
}

// Stands in for a running `hackl serve` engine session and records every contact,
// so a test can tell adoption from an unasked-for engine start.
async function startFakeEngineSession(env, status) {
  const contacts = [];
  const endpoint = sessionEndpoint(env);
  fs.mkdirSync(path.dirname(endpoint), { recursive: true, mode: 0o700 });
  fs.rmSync(endpoint, { force: true });
  const server = net.createServer((socket) => {
    socket.on("data", (chunk) => {
      const request = JSON.parse(chunk.toString().trim());
      contacts.push(request.action);
      socket.write(`${JSON.stringify({ ok: true, status: { hostMode: "leased", leases: 1, ...status } })}\n`);
      socket.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => resolve());
  });
  const close = () => new Promise((resolve) => {
    server.close(() => {
      fs.rmSync(endpoint, { force: true });
      resolve();
    });
  });
  return { contacts, close };
}

function entries(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function sandboxEnv(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-serve-"));
  const state = path.join(root, "state");
  fs.mkdirSync(state, { recursive: true });
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: root,
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_STATE_HOME: state,
    XDG_RUNTIME_DIR: state,
    LLAMACPP_HOME: path.join(root, "no-llamacpp"),
    LLAMACPP_CACHE_ROOT: path.join(root, "cache"),
    ...extra,
  };
  return { root, state, env };
}

function spawnServe(env, argv) {
  const child = spawn(process.execPath, [CLI, ...argv], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const output = () => `${stdout}${stderr}`;
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  const ready = new Promise((resolve, reject) => {
    const poll = () => {
      const match = stdout.match(/Hackl WebUI: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/);
      if (match) return resolve(match[1]);
      if (child.exitCode !== null) return reject(new Error(`serve exited early (${child.exitCode}): ${stdout}${stderr}`));
      setTimeout(poll, 50);
    };
    poll();
  });
  ready.catch(() => { /* tests that expect an exit never await this */ });
  return { child, exited, ready, output };
}

async function chatRoundTrip(url) {
  const ws = new WebSocket(url.replace(/^http/, "ws"));
  try {
    const answer = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no answer from the served web UI")), 20000);
      ws.on("open", () => ws.send(JSON.stringify({ type: "prompt", mode: "ask", prompt: "hi" })));
      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "done") {
          clearTimeout(timer);
          resolve(message.content ?? "");
        }
        if (message.type === "error") {
          clearTimeout(timer);
          reject(new Error(message.message ?? JSON.stringify(message)));
        }
      });
      ws.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
    return answer;
  } finally {
    ws.close();
  }
}

test("serve uses a configured endpoint and never touches the managed engine", async () => {
  const stub = await startStubServer();
  const { root, env } = sandboxEnv({ HACKL_ENDPOINT: stub.endpoint, HACKL_API_KEY: "stub-key" });
  const serve = spawnServe(env, ["serve", "--port", "0", "--model", STUB_MODEL]);
  try {
    const url = await serve.ready;
    assert.match(await chatRoundTrip(url), new RegExp(STUB_ANSWER));
    assert.ok(stub.requests.includes("POST /v1/chat/completions"), "expected the stub to serve the turn");
    assert.ok(stub.requests.includes(`model:${STUB_MODEL}`), "expected the configured model to be requested");
    assert.ok(stub.requests.includes("auth:Bearer stub-key"), "expected the configured key to be sent");
    assert.equal(fs.existsSync(sessionEndpoint(env)), false, "serve must not own an engine session");
    assert.equal(fs.existsSync(path.join(root, "state", "hackl", "engine.json")), false, "no engine was started");
    assert.deepEqual(entries(path.join(root, "cache")), [], "nothing was downloaded");
  } finally {
    serve.child.kill("SIGTERM");
    await serve.exited;
    stub.server.close();
  }
});

test("serve adopts a running engine session when no endpoint is configured", async () => {
  const stub = await startStubServer();
  const { env } = sandboxEnv();
  const fake = await startFakeEngineSession(env, {
    state: "running-external",
    endpoint: stub.endpoint,
    model: STUB_MODEL,
    owner: "cli",
  });
  const serve = spawnServe(env, ["serve", "--port", "0"]);
  try {
    const url = await serve.ready;
    assert.match(await chatRoundTrip(url), new RegExp(STUB_ANSWER));
    assert.ok(fake.contacts.includes("acquire"), "expected the running engine session to be adopted");
    assert.match(serve.output(), new RegExp(`127\.0\.0\.1:${stub.port}`), "expected the adopted endpoint to be served");
  } finally {
    serve.child.kill("SIGTERM");
    await serve.exited;
    await fake.close();
    stub.server.close();
  }
});

test("serve without any endpoint or engine exits with guidance and downloads nothing", async () => {
  const { root, env } = sandboxEnv({ http_proxy: DEAD_PROXY, https_proxy: DEAD_PROXY });
  const serve = spawnServe(env, ["serve", "--port", "0"]);
  const code = await Promise.race([
    serve.exited,
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), 60000);
      timer.unref();
    }),
  ]);
  assert.notEqual(code, "timeout", "serve must not hang when there is nothing to serve");
  const output = serve.output();
  assert.notEqual(code, 0, "serve must fail when there is nothing to serve");
  assert.match(output, /hackl serve downloads nothing/);
  assert.match(output, /HACKL_ENDPOINT=http:\/\/host:port\/v1/);
  assert.match(output, /hackl models install/);
  assert.deepEqual(entries(path.join(root, "cache")), [], "nothing was downloaded");
});
