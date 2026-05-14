const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { LlamaServer, findFreePort } = require("../../dist/server/process.js");

function makeStubBinary() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-stub-"));
  const script = path.join(tmp, "stub-server.js");
  fs.writeFileSync(script, `
const http = require('node:http');
const port = Number(process.argv[process.argv.indexOf('--port') + 1] || 9991);
const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/v1/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'stub-model' }] }));
    return;
  }
  res.writeHead(404).end();
});
server.listen(port, '127.0.0.1', () => { console.log('stub ready on', port); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
`);
  return script;
}

test("LlamaServer starts, becomes ready, and stops cleanly", async () => {
  const port = await findFreePort(9991, 10010);
  const script = makeStubBinary();
  const server = new LlamaServer({
    binaryPath: process.execPath,
    args: [script, "--port", String(port)],
    port,
    readyTimeoutMs: 4000,
  });
  await server.start();
  assert.equal(server.phase, "ready");
  const res = await fetch(`${server.endpoint}/models`);
  assert.equal(res.status, 200);
  await server.stop();
  assert.equal(server.phase, "stopped");
});

test("findFreePort returns an available port", async () => {
  const port = await findFreePort(20000, 20100);
  assert.ok(port >= 20000 && port <= 20100);
});

test("LlamaServer parses tokens/s from llama.cpp eval log line", async () => {
  const port = await findFreePort(9991, 10010);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-stub-tps-"));
  const script = path.join(tmpDir, "stub.js");
  fs.writeFileSync(script, `
    const http = require('node:http');
    const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
    const srv = http.createServer((req, res) => {
      if (req.url.startsWith('/v1/models')) { res.writeHead(200, {'content-type':'application/json'}); res.end('{"data":[{"id":"x"}]}'); return; }
      res.writeHead(404).end();
    });
    srv.listen(port, '127.0.0.1', () => {
      console.log('stub up');
      setTimeout(() => {
        console.log('eval time =  500.00 ms /   100 runs   (   5.00 ms per token,   200.00 tokens per second)');
      }, 200);
    });
    process.on('SIGTERM', () => srv.close(() => process.exit(0)));
  `);
  const server = new LlamaServer({
    binaryPath: process.execPath,
    args: [script, "--port", String(port)],
    port,
    readyTimeoutMs: 4000,
  });
  const tpsValues = [];
  server.on("tokensPerSecond", (v) => tpsValues.push(v));
  await server.start();
  // Wait a bit for the delayed eval line.
  await new Promise((r) => setTimeout(r, 500));
  await server.stop();
  assert.ok(tpsValues.includes(200), `expected 200 t/s, saw ${JSON.stringify(tpsValues)}`);
});
