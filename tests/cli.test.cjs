const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

test("CLI reads stdin and argv, runs tools in a sandbox, and writes the answer to stdout", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-cli-"));
  fs.mkdirSync(path.join(sandbox, ".git"));
  fs.writeFileSync(path.join(sandbox, "note.txt"), "needle\n");
  const requests = [];
  const server = await startServer([
    'HACKL_TOOL {"name":"read_file","path":"note.txt","start_line":1,"end_line":1}',
    "final answer from cli",
  ], requests);

  try {
    const result = await runCli([
      "--endpoint", server.endpoint,
      "--cwd", sandbox,
      "--file", "note.txt:1",
      "argv prompt",
    ], "stdin prompt\n");

    assert.equal(result.code, 0);
    assert.match(result.stdout, /final answer from cli/);
    assert.match(result.stderr, /Preprocessing prompt/);
    const chatRequests = requests.filter((entry) => entry.url === "/v1/chat/completions");
    assert.equal(chatRequests.length, 2);
    const firstCompletion = JSON.parse(chatRequests[0].body);
    assert.equal(firstCompletion.stream, true);
    assert.match(firstCompletion.messages.at(-1).content, /argv prompt/);
    assert.match(firstCompletion.messages.at(-1).content, /stdin prompt/);
    assert.match(firstCompletion.messages.at(-1).content, /note\.txt \[active/);
    assert.match(JSON.parse(chatRequests[1].body).messages.at(-1).content, /HACKL_TOOL_RESULT read_file ok/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function startServer(completions, requests) {
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.url === "/v1/models") {
        requests.push({ url: request.url, body: Buffer.concat(chunks).toString("utf8") });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ data: [{ id: "test-model" }] }));
        return;
      }
      if (request.url === "/v1/props") {
        response.writeHead(404);
        response.end();
        return;
      }
      if (request.url === "/v1/chat/completions") {
        requests.push({ url: request.url, body: Buffer.concat(chunks).toString("utf8") });
        const content = completions.shift();
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`);
        return;
      }
      response.writeHead(404);
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return Object.assign(server, {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
  });
}

function runCli(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "../dist/cli.js"), ...args], {
      cwd: path.join(__dirname, ".."),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}
