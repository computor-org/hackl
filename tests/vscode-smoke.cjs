const assert = require("node:assert/strict");
const vscode = require("vscode");

async function run() {
  const extension = vscode.extensions.getExtension("computor-org.hackl");
  assert.ok(extension, "Hackl extension is registered");

  const properties = extension.packageJSON.contributes.configuration.properties;
  assert.ok(properties["hackl.endpoint"], "hackl.endpoint setting is contributed");
  assert.equal(properties["hackl.endpoint"].default, "");
  assert.equal(properties["hackl.model"], undefined);

  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("hackl.chat"), "hackl.chat command is registered");

  await vscode.commands.executeCommand("hackl.chat");
}

module.exports = { run };
