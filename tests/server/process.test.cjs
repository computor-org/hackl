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
