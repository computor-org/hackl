const assert = require("node:assert/strict");
const http = require("node:http");
const vscode = require("vscode");

const EXTENSION_ID = "computor-org.hackl";

async function run() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, "Hackl extension is registered");

  const configuration = extension.packageJSON.contributes.configuration;
  const sections = Array.isArray(configuration) ? configuration : [configuration];
  const properties = Object.assign({}, ...sections.map((section) => section.properties));
  assert.ok(properties["hackl.endpoint"], "hackl.endpoint setting is contributed");
  assert.equal(properties["hackl.endpoint"].default, "");
  assert.equal(properties["hackl.engine.enabled"].default, true);
  assert.equal(properties["hackl.debug"].default, false);
  assert.ok(extension.packageJSON.contributes.viewsContainers.activitybar, "Hackl contributes an Activity Bar fallback");
  assert.ok(extension.packageJSON.contributes.viewsContainers.secondarySidebar, "Hackl contributes a secondary sidebar container");
  assert.equal(extension.packageJSON.contributes.views["hackl.activitybar"][0].id, "hackl.chatActivitybar");
  assert.ok(extension.packageJSON.contributes.views.hackl, "Hackl view container has views");
  assert.equal(extension.packageJSON.contributes.views.hackl[0].id, "hackl.chatView");
  assert.equal(extension.packageJSON.contributes.views.hackl[0].type, "webview");
  assert.equal(extension.packageJSON.bin, undefined, "no CLI bin entry");
  for (const found of extension.packageJSON.contributes.commands) {
    assert.notEqual(found.command, "hackl.chatEditor", "chatEditor command should be gone");
  }

  const api = await extension.activate();
  assert.ok(api && typeof api === "object", "extension export an API");
  assert.equal(typeof api.openChat, "function");
  assert.equal(typeof api.getBasket, "function");
  assert.equal(typeof api.addTarget, "function");
  assert.equal(typeof api.clearBasket, "function");
  assert.equal(api.setReviewContext, undefined, "review-context surface removed from public API");
  assert.equal(api.addReviewComment, undefined, "addReviewComment removed from public API");

  const commands = await vscode.commands.getCommands(true);
  for (const expected of [
    "hackl.chat",
    "hackl.openWalkthrough",
    "hackl.configureConnection",
    "hackl.codexLogin",
    "hackl.checkLocalServer",
    "hackl.addSelectionToContext",
    "hackl.addCurrentFileToContext",
    "hackl.clearContext",
    "hackl.discardLastAnnotations",
    "hackl.reviewStagedChanges",
    "hackl.revealTarget",
    "hackl.toggleEngine",
    "hackl.engineStatus",
    "hackl.selectModel",
    "hackl.downloadModel",
    "hackl.startEngine",
  ]) {
    assert.ok(commands.includes(expected), `${expected} command is registered`);
  }
  assert.ok(!commands.includes("hackl.chatEditor"), "hackl.chatEditor command should not exist");
  for (const removed of ["hackl.engineStart", "hackl.engineStop", "hackl.engineRestart"]) {
    assert.ok(!commands.includes(removed), `${removed} command should not exist`);
  }

  await testBasketRoundtrip(api);
  await testClearBasket(api);
  await runOpenChat();
  await testReviewCommandStartsReview(api);
}

async function testBasketRoundtrip(api) {
  api.clearBasket();
  api.addTarget({
    id: "src-e2e-1",
    addedAt: Date.now(),
    kind: "source-range",
    uri: "file:///tmp/x.ts",
    languageId: "typescript",
    relativePath: "x.ts",
    startLine: 1, startCharacter: 1, endLine: 3, endCharacter: 1,
    text: "// e2e\nconst x = 1;\n",
    truncated: false,
  });
  const snap = api.getBasket();
  assert.equal(snap.targets.length, 1, "basket has one target after addTarget");
  assert.equal(snap.targets[0].id, "src-e2e-1");
  api.removeTarget("src-e2e-1");
  assert.equal(api.getBasket().targets.length, 0, "basket is empty after removeTarget");
}

async function testClearBasket(api) {
  api.addTarget({
    id: "src-e2e-2",
    addedAt: Date.now(),
    kind: "source-range",
    uri: "file:///tmp/y.ts",
    languageId: "typescript",
    relativePath: "y.ts",
    startLine: 1, startCharacter: 1, endLine: 1, endCharacter: 1,
    text: "y", truncated: false,
  });
  assert.equal(api.getBasket().targets.length, 1);
  api.clearBasket();
  assert.equal(api.getBasket().targets.length, 0);
}

async function runOpenChat() {
  await vscode.commands.executeCommand("hackl.chat");
}

// The review command has to start the review on its own; a stub endpoint makes
// it observable as an outgoing chat request (#39).
async function testReviewCommandStartsReview(api) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const path = request.url ?? "";
      requests.push({ path, body: raw ? JSON.parse(raw) : undefined });
      response.writeHead(200, { "Content-Type": "application/json" });
      if (path.endsWith("/chat/completions")) {
        response.end(JSON.stringify({
          model: "stub-review-model",
          choices: [{ index: 0, message: { role: "assistant", content: "Reviewed: no findings." } }],
        }));
        return;
      }
      if (path.endsWith("/models")) {
        response.end(JSON.stringify({ data: [{ id: "stub-review-model" }] }));
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const configuration = vscode.workspace.getConfiguration("hackl");
  await configuration.update("endpoint", `http://127.0.0.1:${address.port}/v1`, vscode.ConfigurationTarget.Global);
  await configuration.update("model", "stub-review-model", vscode.ConfigurationTarget.Global);
  api.clearBasket();
  api.addTarget({
    id: "src-review-1",
    addedAt: Date.now(),
    kind: "source-range",
    uri: "file:///tmp/review-me.ts",
    languageId: "typescript",
    relativePath: "review-me.ts",
    startLine: 1, startCharacter: 0, endLine: 2, endCharacter: 0,
    text: "const a = 1;\nconst b = 0;\n",
    truncated: false,
  });
  try {
    await vscode.commands.executeCommand("hackl.reviewStagedChanges");
    const chat = requests.find((entry) => entry.path.endsWith("/chat/completions"));
    assert.ok(chat, "hackl.reviewStagedChanges sends a chat request without further input");
    const messages = JSON.stringify(chat.body?.messages ?? "");
    assert.match(messages, /Review the selected context for correctness/, "the review prompt is sent");
    assert.match(messages, /review-me\.ts/, "the attached context is part of the review request");
  } finally {
    api.clearBasket();
    await configuration.update("model", undefined, vscode.ConfigurationTarget.Global);
    await configuration.update("endpoint", undefined, vscode.ConfigurationTarget.Global);
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { run };
