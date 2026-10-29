const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

// Issue #38: an answer that the VS Code chat renders as a list and a typeset
// formula must not reach the browser as plain text. The renderer is browser
// TypeScript, so build it to CJS and assert on the markup the UI injects.
const bundle = path.join(os.tmpdir(), `hackl-webui-markdown-${process.pid}.cjs`);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "..", "src", "markdown.ts")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
});
test.after(() => fs.rmSync(bundle, { force: true }));

const { renderMarkdown } = require(bundle);

test("assistant markdown renders blocks instead of literal text", () => {
  const html = renderMarkdown("- Item one\n- Item two\n");
  assert.match(html, /^<ul>\n<li>Item one<\/li>\n<li>Item two<\/li>\n<\/ul>\n$/);
});

test("inline and display formulas become KaTeX markup", () => {
  const inline = renderMarkdown("Energy: $E=mc^2$");
  assert.match(inline, /<span class="katex">/);
  assert.match(inline, /<annotation encoding="application\/x-tex">E=mc\^2<\/annotation>/);

  const display = renderMarkdown("$$\\int_0^1 x\\,dx$$");
  assert.match(display, /class="katex-display"/);
});

test("an unrenderable formula does not break the answer", () => {
  const html = renderMarkdown("bad $\\frac{1}{$ and tail");
  assert.ok(html.length > 0);
});

test("model output cannot inject html", () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)"> <script>alert(2)</script>');
  assert.ok(!html.includes("<img"), html);
  assert.ok(!html.includes("<script"), html);
  assert.match(html, /&lt;img/);
});

test("a streaming answer re-renders from the accumulated text", () => {
  const partial = renderMarkdown("- Item on");
  assert.match(partial, /^<ul>/);
  const rest = renderMarkdown("- Item one\n- Item two");
  assert.match(rest, /<li>Item two<\/li>/);
});
