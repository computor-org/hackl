const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { downloadFile, isCancellation } = require("../../dist/server/installer.js");

test("downloadFile aborts when isCancelled returns true", async () => {
  // Slow trickling server: send 1 KB every 50 ms.
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "content-length": String(1024 * 1024), "content-type": "application/octet-stream" });
    const buf = Buffer.alloc(1024, 0x41);
    let n = 0;
    const i = setInterval(() => {
      n += 1;
      res.write(buf);
      if (n >= 1024) { clearInterval(i); res.end(); }
    }, 50);
    req.on("close", () => clearInterval(i));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-dl-"));
  const dest = path.join(dir, "out.bin");
  let cancelled = false;
  const sink = {
    message: () => undefined,
    fraction: () => undefined,
    isCancelled: () => cancelled,
  };
  setTimeout(() => { cancelled = true; }, 150);
  let err;
  try {
    await downloadFile(`http://127.0.0.1:${port}/x`, dest, sink);
  } catch (e) {
    err = e;
  }
  srv.close();
  assert.ok(err, "download should have thrown");
  assert.ok(isCancellation(err), `expected cancellation, got ${err && err.message}`);
  // The partial file should NOT have been renamed to the final destination.
  assert.equal(fs.existsSync(dest), false);
});
