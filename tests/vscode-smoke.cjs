const assert = require("node:assert/strict");
const vscode = require("vscode");

async function run() {
  const extension = vscode.extensions.getExtension("computor-org.hackl");
  assert.ok(extension, "Hackl extension is registered");

  const properties = extension.packageJSON.contributes.configuration.properties;
  assert.ok(properties["hackl.endpoint"], "hackl.endpoint setting is contributed");
  assert.equal(properties["hackl.endpoint"].default, "");
  assert.equal(properties["hackl.debug"].default, true);
  assert.equal(properties["hackl.model"], undefined);
  assert.ok(extension.packageJSON.contributes.viewsContainers.secondarySidebar, "Hackl contributes a secondary sidebar container");
  assert.ok(extension.packageJSON.contributes.views.hackl, "Hackl view container has views");
  assert.equal(extension.packageJSON.contributes.views.hackl[0].id, "hackl.chatView");
  assert.equal(extension.packageJSON.contributes.views.hackl[0].type, "webview");

  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("hackl.chat"), "hackl.chat command is registered");
  assert.ok(commands.includes("hackl.chatEditor"), "hackl.chatEditor command is registered");

  await vscode.commands.executeCommand("hackl.chat");
  await vscode.commands.executeCommand("hackl.chatEditor");
}

module.exports = { run };
