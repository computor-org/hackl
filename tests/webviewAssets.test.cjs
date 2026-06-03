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
  assert.match(css, /\.hidden-unavailable/);
  assert.match(css, /\.tool-button\[aria-pressed="true"\]/);
});

test("main.js still wires the key element ids the HTML shell renders", () => {
  const file = path.join(root, "media/chat/main.js");
  const src = fs.readFileSync(file, "utf8");
  for (const id of ["form", "prompt", "thread", "send", "annotations-discard", "mode-button", "basket-list", "basket-add"]) {
    assert.match(src, new RegExp(`"${id}"`), `main.js missing id "${id}"`);
  }
  assert.match(src, /diffTruncated/);
});

test("chat UI uses context wording instead of visible basket wording", () => {
  const htmlFile = path.join(root, "src/chatHtml.ts");
  const jsFile = path.join(root, "media/chat/main.js");
  const html = fs.readFileSync(htmlFile, "utf8");
  const js = fs.readFileSync(jsFile, "utf8");
  assert.match(html, />Context</);
  assert.match(html, /Attach context/);
  assert.match(html, /Clear context/);
  assert.doesNotMatch(html, /Targets</);
  assert.doesNotMatch(html, /Clear basket/);
  assert.doesNotMatch(html, /in the basket/);
  assert.doesNotMatch(js, /Review the basket/);
});

test("chat UI uses attach context menu instead of annotation toggle", () => {
  const htmlFile = path.join(root, "src/chatHtml.ts");
  const jsFile = path.join(root, "media/chat/main.js");
  const html = fs.readFileSync(htmlFile, "utf8");
  const js = fs.readFileSync(jsFile, "utf8");
  assert.match(html, /title="Attach context"/);
  assert.match(js, /"hackl\.attachContext"/);
  assert.doesNotMatch(html, /annotations-toggle/);
  assert.doesNotMatch(js, /annotationsToggle/);
  assert.doesNotMatch(js, /setCreateAnnotations/);
});

test("connect hint follows explicit connection state instead of model text", () => {
  const file = path.join(root, "media/chat/main.js");
  const src = fs.readFileSync(file, "utf8");
  assert.match(src, /message\.connected === false/);
  assert.doesNotMatch(src, /const needsConnect = !message\.model/);
});

test("send button remains icon-only", () => {
  const htmlFile = path.join(root, "src/chatHtml.ts");
  const jsFile = path.join(root, "media/chat/main.js");
  const html = fs.readFileSync(htmlFile, "utf8");
  const js = fs.readFileSync(jsFile, "utf8");
  assert.match(html, /id="send"[^>]*class="send-button"[^>]*>.*codicon-arrow-up/s);
  assert.doesNotMatch(html, /send-label/);
  assert.doesNotMatch(js, /send-label/);
});
