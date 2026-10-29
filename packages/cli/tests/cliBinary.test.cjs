const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

// The real consumer: the CLI entry point dist/index.js, driven against a
// stub OpenAI-compatible endpoint. tsc -b emits this file too, so no bundle is needed.
const CLI = path.join(__dirname, "..", "dist", "index.js");

// An empty workspace, so read_file main.py fails the same way everywhere.
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-cli-test-"));
test.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function runCli(endpoint, prompt, env, extra = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, "--endpoint", endpoint, "--model", "m", "--mode", "ask", ...extra, prompt], {
      env: { ...process.env, HACKL_API_KEY: "", ...env },
      cwd: workspace,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const errorLines = (stderr) => stderr.split("\n").filter((line) => /^(error:|hackl:)/.test(line));

test("an unreachable endpoint fails once and names the endpoint", async () => {
  // Bind and close to get a port nothing listens on (fetch itself blocks port 9).
  const probe = await listen(() => {});
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const endpoint = `http://127.0.0.1:${port}/v1`;
  const { code, stderr } = await runCli(endpoint, "hi");

  assert.equal(code, 1);
  assert.deepEqual(errorLines(stderr), [
    `error: Cannot reach ${endpoint}: connect ECONNREFUSED 127.0.0.1:${port}. `
    + "Start a server there, or choose another endpoint (--endpoint or HACKL_ENDPOINT).",
  ]);
});

test("a missing key and a rejected key are told apart, and the key is never printed", async () => {
  const server = await listen((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "no key provided" } }));
  });
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    const missing = await runCli(endpoint, "hi");
    assert.equal(missing.code, 1);
    assert.deepEqual(errorLines(missing.stderr), [
      `error: The endpoint ${endpoint} rejected the request (HTTP 401): no API key set. `
      + "Set it with --api-key or HACKL_API_KEY (in VS Code: Hackl: Set API Key).",
    ]);

    const wrong = await runCli(endpoint, "hi", { HACKL_API_KEY: "sk-test-should-never-appear" });
    assert.equal(wrong.code, 1);
    assert.equal(errorLines(wrong.stderr).length, 1);
    assert.match(errorLines(wrong.stderr)[0], /rejected the request \(HTTP 401\): the API key was rejected\./);
    assert.ok(!wrong.stderr.includes("sk-test-should-never-appear"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a failed tool call is shown in text output and in NDJSON", async () => {
  let calls = 0;
  const server = await listen((req, res) => {
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    calls += 1;
    const content = calls === 1
      ? 'HACKL_TOOL {"name":"read_file","path":"main.py"}'
      : "That file is not there.";
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content } }] })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    const text = await runCli(endpoint, "read main.py");
    assert.equal(text.code, 0);
    assert.match(text.stderr, /· read_file main\.py failed: File does not exist: main\.py/);
    assert.equal(text.stdout, "That file is not there.\n");

    calls = 0;
    const json = await runCli(endpoint, "read main.py", {}, ["--json"]);
    const events = json.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(
      events.filter((event) => event.type === "tool_result"),
      [{ type: "tool_result", name: "read_file", args: "main.py", ok: false, reason: "File does not exist: main.py" }],
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
