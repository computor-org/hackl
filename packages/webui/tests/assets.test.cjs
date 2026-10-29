const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const dist = path.join(__dirname, "..", "dist");

test("web UI bundle builds and ships index.html, main.js, main.css", () => {
  for (const file of ["index.html", "main.js", "main.css", "katex.css"]) {
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
  assert.match(html, /href="\/katex\.css"/);
});

test("katex.css loads its woff2 fonts from the same origin", () => {
  const css = fs.readFileSync(path.join(dist, "katex.css"), "utf8");
  assert.match(css, /\.katex/);
  const fonts = [...css.matchAll(/url\((fonts\/[^)]+)\)/g)].map((m) => m[1]);
  assert.ok(fonts.length > 0 && fonts.every((f) => f.endsWith(".woff2")), "katex.css fonts are not all woff2");
  for (const font of fonts) assert.ok(fs.existsSync(path.join(dist, font)), `missing ${font}`);
});

test("bundle speaks the protocol and never embeds the api key path", () => {
  const js = fs.readFileSync(path.join(dist, "main.js"), "utf8");
  // Protocol message types the client must send/handle.
  for (const token of ["approvalResponse", "approvalRequested", "\"prompt\"", "cancel", "ready"]) {
    assert.ok(js.includes(token), `bundle missing protocol token ${token}`);
  }
  // Assistant answers are rendered markdown, so the renderer ships in the bundle.
  assert.ok(js.includes("katex"), "bundle does not carry the formula renderer");
  // The browser bundle must not contain server-only secrets or Node imports.
  assert.ok(!js.includes("HACKL_API_KEY"), "bundle leaks HACKL_API_KEY");
  assert.ok(!/require\("node:/.test(js), "bundle pulled in a Node builtin");
});
