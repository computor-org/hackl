const assert = require("node:assert/strict");
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
  assert.ok(extension.packageJSON.contributes.viewsContainers.secondarySidebar, "Hackl contributes a secondary sidebar container");
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

module.exports = { run };
