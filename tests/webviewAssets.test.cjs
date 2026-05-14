const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("media/chat/main.js exists and is syntactically valid JS", () => {
  const file = path.join(root, "media/chat/main.js");
  const src = fs.readFileSync(file, "utf8");
  assert.ok(src.length > 1000, `main.js is suspiciously short: ${src.length} bytes`);
  assert.doesNotThrow(() => new Function(src));
});

test("media/chat/main.css exists and contains expected rules", () => {
  const file = path.join(root, "media/chat/main.css");
  const css = fs.readFileSync(file, "utf8");
  assert.ok(css.length > 1000, `main.css is suspiciously short: ${css.length} bytes`);
  assert.match(css, /\.send-button/);
  assert.match(css, /\.send-label/);
  assert.match(css, /\.hidden-unavailable/);
  assert.match(css, /\.tool-button\[aria-pressed="true"\]/);
});

test("main.js still wires the key element ids the HTML shell renders", () => {
  const file = path.join(root, "media/chat/main.js");
  const src = fs.readFileSync(file, "utf8");
  for (const id of ["form", "prompt", "thread", "send", "annotations-toggle", "annotations-discard", "mode-button", "basket-list"]) {
    assert.match(src, new RegExp(`"${id}"`), `main.js missing id "${id}"`);
  }
  assert.match(src, /diffTruncated/);
});
