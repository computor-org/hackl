const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const dist = path.join(__dirname, "..", "dist");

test("web UI bundle builds and ships index.html, main.js, main.css", () => {
  for (const file of ["index.html", "main.js", "main.css"]) {
    assert.ok(fs.existsSync(path.join(dist, file)), `missing ${file}`);
  }
});

test("index.html wires the element ids main.ts depends on", () => {
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  for (const id of ["thread", "composer", "prompt", "mode", "send", "cancel", "yolo-banner", "conn", "meter"]) {
    assert.match(html, new RegExp(`id="${id}"`), `index.html missing #${id}`);
  }
  assert.match(html, /src="\/main\.js"/);
  assert.match(html, /href="\/main\.css"/);
});

test("bundle speaks the protocol and never embeds the api key path", () => {
  const js = fs.readFileSync(path.join(dist, "main.js"), "utf8");
  // Protocol message types the client must send/handle.
  for (const token of ["approvalResponse", "approvalRequested", "\"prompt\"", "cancel", "ready"]) {
    assert.ok(js.includes(token), `bundle missing protocol token ${token}`);
  }
  // The browser bundle must not contain server-only secrets or Node imports.
  assert.ok(!js.includes("HACKL_API_KEY"), "bundle leaks HACKL_API_KEY");
  assert.ok(!/require\("node:/.test(js), "bundle pulled in a Node builtin");
});
