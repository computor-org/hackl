const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// dist/chatHtml.js imports vscode at load time; stub it just enough to render
// the document head, the same way the webview UI smoke harness does.
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return {
      Uri: {
        joinPath(base, ...parts) {
          const fsPath = path.join(base.fsPath, ...parts);
          return { fsPath, toString: () => pathToFileURL(fsPath).href };
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { renderChatHtml } = require("../dist/chatHtml.js");
Module._load = originalLoad;

function cspDirectives() {
  const webview = {
    cspSource: "https://webview.invalid",
    asWebviewUri: (uri) => ({ toString: () => uri.toString() }),
  };
  const html = renderChatHtml(webview, { fsPath: "/ext" });
  const meta = html.match(/Content-Security-Policy" content="([^"]+)"/);
  assert.ok(meta, "the chat webview html must carry a CSP meta tag");
  const directives = {};
  for (const part of meta[1].split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    directives[name] = sources;
  }
  return directives;
}

test("style-src allows the inline styles KaTeX needs for vertical offsets", () => {
  const csp = cspDirectives();
  assert.ok(csp["style-src"].includes("'unsafe-inline'"), "KaTeX positions super/subscripts and fractions with inline top offsets");
  assert.ok(csp["style-src"].includes("https://webview.invalid"), "external styles still load from the webview origin");
});

test("the CSP keeps its other hardening intact", () => {
  const csp = cspDirectives();
  assert.deepEqual(csp["default-src"], ["'none'"]);
  assert.ok(csp["script-src"].some((s) => /^'nonce-[0-9a-f]{32}'$/.test(s)), "script-src must stay nonce-bound");
  assert.ok(!csp["script-src"].includes("'unsafe-inline'"), "scripts must never accept unsafe-inline");
  assert.ok(!csp["style-src"].includes("'unsafe-eval'"));
  assert.ok(!csp["img-src"].includes("*"), "img-src stays pinned to the webview origin and data:");
  assert.deepEqual(csp["font-src"], ["https://webview.invalid"]);
});
