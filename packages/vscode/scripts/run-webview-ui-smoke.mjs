#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import Module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
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
const vscodeApiShim = `<script>
  window.__hacklPosted = [];
  window.acquireVsCodeApi = () => ({
    postMessage(message) {
      window.__hacklPosted.push(message);
    }
  });
</script>`;

const server = await startStaticServer(process.cwd());
const extensionUri = { fsPath: process.cwd() };
const webview = {
  cspSource: server.origin,
  asWebviewUri(uri) {
    return { toString: () => server.urlFor(uri.fsPath) };
  },
};
const html = renderChatHtml(webview, extensionUri);
const browser = await chromium.launch({ executablePath: findChromium() });

try {
  const page = await browser.newPage();
  const diagnostics = [];
  page.on("console", (message) => diagnostics.push(`console:${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));

  await page.setContent(`${vscodeApiShim}${html}`, { waitUntil: "load" });
  await waitFor(page, () => window.__hacklPosted?.some((message) => message.type === "ready"), diagnostics);

  // Send button stays icon-only.
  assert.equal(await page.locator("#send-label").count(), 0);
  assert.equal(await page.locator("#send .codicon-arrow-up").count(), 1);

  // With no text and no annotation context, the send button stays disabled.
  await page.locator("#prompt").fill("x");
  await page.locator("#prompt").fill("");
  await page.waitForFunction(() => document.getElementById("send").disabled === true);

  // The basket is hidden until a target lands in it.
  assert.equal(await page.locator("#basket").isVisible(), false);

  // A basket target carrying an annotation note enables sending an empty prompt.
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "basket", targets: [{ id: "t-1", kind: "source-range", relativePath: "x.ts", startLine: 1, endLine: 2, metadata: { note: "fix this" } }] },
    }));
  });
  await page.waitForFunction(() => document.getElementById("send").disabled === false);
  assert.equal(await page.locator("#basket").isVisible(), true);
  assert.equal(await page.locator("#basket-count").innerText(), "1");

  // A target without a note still shows in the basket but does not enable an empty send.
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "basket", targets: [{ id: "staged-1", kind: "staged-changes", workspaceRoot: "/tmp/repo", files: ["x.ts"] }] },
    }));
  });
  await page.waitForFunction(() => document.getElementById("send").disabled === true);
  assert.equal(await page.locator("#basket").isVisible(), true);

  // setPromptText populates the textarea
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "setPromptText", text: "preset" } }));
  });
  assert.equal(await page.locator("#prompt").inputValue(), "preset");
  await page.locator("#prompt").fill("");

  // Clear basket so subsequent prompts behave as before
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "basket", targets: [] } }));
  });

  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "state",
        enableThinking: false,
        endpoint: "http://localhost:1234/v1",
        model: "qwen3-coder",
      },
    }));
  });
  assert.equal(await page.locator("#endpoint-status").innerText(), "localhost:1234 · qwen3-coder");
  assert.match(await page.locator("#endpoint-status").getAttribute("title"), /endpoint and model/i);
  await page.locator("#prompt").fill("Explain energy");
  await page.keyboard.press("Enter");
  await waitFor(page, () => window.__hacklPosted?.some((message) => message.type === "prompt"), diagnostics);
  assert.deepEqual(
    await page.evaluate(() => window.__hacklPosted.find((message) => message.type === "prompt")),
    { type: "prompt", prompt: "Explain energy", mode: "ask" },
  );

  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "status", text: "Thinking..." } }));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "answer",
        text: "Energy is $E=mc^2$.\n\n$$F=ma$$\n\n```js\nconst mass = 1;\n```",
      },
    }));
  });

  await page.locator(".assistant .katex").first().waitFor();
  assert.equal(await page.locator(".user .body").innerText(), "Explain energy");
  assert.match(await page.locator(".assistant .body").innerText(), /Energy is/);
  assert.match(await page.locator(".assistant pre code").innerText(), /const mass = 1/);
  assert.equal(await page.locator(".status").count(), 0);

  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "assistantDelta",
        channel: "reasoning",
        text: Array.from({ length: 40 }, (_, index) => `step ${index}`).join("\n"),
      },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "assistantDelta",
        channel: "answer",
        text: Array.from({ length: 80 }, (_, index) => `line ${index}`).join("\n"),
      },
    }));
  });

  const reasoningText = page.locator(".assistant").last().locator(".reasoning-text");
  await reasoningText.waitFor();
  const collapsedHeight = await reasoningText.evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(collapsedHeight <= 50, `reasoning should be collapsed, got ${collapsedHeight}`);
  await page.locator(".assistant").last().locator(".reasoning-toggle").click();
  const expandedHeight = await reasoningText.evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(expandedHeight > collapsedHeight, "reasoning should expand on click");

  await page.locator("#mode-button").click();
  assert.equal(await page.locator('.mode-option[data-value="agent"]').isDisabled(), false);
  await page.locator('.mode-option[data-value="edit"]').click();
  await page.locator("#prompt").fill("Rename x to y");
  await page.keyboard.press("Enter");
  await waitFor(page, () => window.__hacklPosted?.some((message) => message.prompt === "Rename x to y"), diagnostics);
  assert.deepEqual(
    await page.evaluate(() => window.__hacklPosted.find((message) => message.prompt === "Rename x to y")),
    { type: "prompt", prompt: "Rename x to y", mode: "edit" },
  );
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "answer", text: "Renamed." } }));
  });
  await page.locator("#mode-button").click();
  assert.equal(await page.locator('.mode-option[data-value="work"]').isDisabled(), false);
  await page.locator('.mode-option[data-value="work"]').click();
  await page.locator("#prompt").fill("Update the call sites");
  await page.keyboard.press("Enter");
  await waitFor(page, () => window.__hacklPosted?.some((message) => message.prompt === "Update the call sites"), diagnostics);
  assert.deepEqual(
    await page.evaluate(() => window.__hacklPosted.find((message) => message.prompt === "Update the call sites")),
    { type: "prompt", prompt: "Update the call sites", mode: "work" },
  );
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "answer", text: "Updated." } }));
  });

  await page.locator("#mode-button").click();
  await page.locator('.mode-option[data-value="agent"]').click();
  await page.locator("#prompt").fill("Run the checks");
  await page.keyboard.press("Enter");
  await waitFor(page, () => window.__hacklPosted?.some((message) => message.prompt === "Run the checks"), diagnostics);
  assert.deepEqual(
    await page.evaluate(() => window.__hacklPosted.find((message) => message.prompt === "Run the checks")),
    { type: "prompt", prompt: "Run the checks", mode: "agent" },
  );

  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "approvalRequested",
        id: "42",
        title: "Run command?",
        detail: "npm test",
        approveLabel: "Run",
        denyLabel: "Deny",
      },
    }));
  });
  await page.locator(".approval button", { hasText: "Run" }).click();
  await waitFor(page, () => window.__hacklPosted?.some((message) => message.type === "approvalResponse"), diagnostics);
  assert.deepEqual(
    await page.evaluate(() => window.__hacklPosted.find((message) => message.type === "approvalResponse")),
    { type: "approvalResponse", approvalId: "42", approved: true },
  );
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "answer", text: "Checked." } }));
  });

  await page.locator("#mode-button").click();
  assert.deepEqual(await page.locator(".mode-option").allTextContents(), ["Ask", "Edit", "Work", "Agent", "Yolo"]);

  const promptBox = await page.locator("#prompt").boundingBox();
  const viewport = page.viewportSize();
  assert.ok(promptBox);
  assert.ok(viewport);
  assert.ok(promptBox.y + promptBox.height <= viewport.height, "prompt box should stay visible");
  console.log("webview UI smoke passed");
} finally {
  await browser.close();
  await server.close();
  Module._load = originalLoad;
}

async function waitFor(page, predicate, diagnostics) {
  try {
    await page.waitForFunction(predicate, undefined, { timeout: 30000 });
  } catch (error) {
    if (diagnostics.length > 0) {
      console.error(diagnostics.join("\n"));
    }
    throw error;
  }
}

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  }
  for (const candidate of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function startStaticServer(root) {
  const listener = createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const file = path.resolve(root, `.${requestPath}`);
    if (!file.startsWith(root) || !existsSync(file)) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, { "Content-Type": mimeType(file) });
    response.end(require("node:fs").readFileSync(file));
  });
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    urlFor(file) {
      const relative = path.relative(root, file).split(path.sep).map(encodeURIComponent).join("/");
      return `${origin}/${relative}`;
    },
    close() {
      return new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function mimeType(file) {
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".js")) return "text/javascript";
  if (file.endsWith(".ttf")) return "font/ttf";
  if (file.endsWith(".woff")) return "font/woff";
  if (file.endsWith(".woff2")) return "font/woff2";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}
