const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
}

function command(manifest, id) {
  return manifest.contributes.commands.find((item) => item.command === id);
}

test("annotation comment commands are not globally disabled", () => {
  const manifest = readManifest();
  for (const id of ["hackl.replyToAnnotationThread", "hackl.deleteAnnotationThread", "hackl.resolveAnnotationThread", "hackl.revealTarget"]) {
    assert.equal(command(manifest, id)?.enablement, undefined, `${id} must be invokable from VS Code UI contexts`);
  }
});

test("Hackl activates at startup so editor comment ranges survive startup", () => {
  const manifest = readManifest();
  assert.deepEqual(manifest.activationEvents, ["*"]);
});

test("context command titles use user-facing context wording", () => {
  const manifest = readManifest();
  assert.equal(command(manifest, "hackl.addSelectionToContext")?.title, "Add Selection");
  assert.equal(command(manifest, "hackl.addCurrentFileToContext")?.title, "Add Current File");
  assert.equal(command(manifest, "hackl.addAnnotationNote")?.title, "Add Annotation Note");
  assert.equal(command(manifest, "hackl.addStagedChangesToContext")?.title, "Add Staged Changes");
  assert.equal(command(manifest, "hackl.clearContext")?.title, "Clear Context");
  assert.equal(command(manifest, "hackl.reviewStagedChanges")?.title, "Review Staged Changes");
});

test("annotation note command stays out of the editor context menu", () => {
  const manifest = readManifest();
  const item = manifest.contributes.menus["editor/context"].find((entry) => entry.command === "hackl.addAnnotationNote");
  assert.equal(item, undefined);
});

test("comment editor enter submits, shift-enter inserts newline, escape dismisses empty draft", () => {
  const manifest = readManifest();
  const enter = manifest.contributes.keybindings.find((item) => item.key === "enter" && item.command === "hackl.submitFocusedCommentOnEnter");
  const newline = manifest.contributes.keybindings.find((item) => item.key === "shift+enter" && item.command === "type");
  const escape = manifest.contributes.keybindings.find((item) => item.key === "escape" && item.command === "hackl.dismissFocusedEmptyComment");
  assert.ok(enter, "Enter must dispatch hackl.submitFocusedCommentOnEnter");
  assert.match(enter.when, /commentEditorFocused/);
  assert.doesNotMatch(enter.when, /commentIsEmpty/);
  assert.ok(newline, "Shift+Enter must insert a newline");
  assert.deepEqual(newline.args, { text: "\n" });
  assert.ok(escape, "Escape must dispatch hackl.dismissFocusedEmptyComment");
  assert.match(escape.when, /commentEditorFocused/);
  assert.match(escape.when, /commentIsEmpty/);
});

test("annotation reply is the only custom comment editor action", () => {
  const manifest = readManifest();
  const menus = manifest.contributes.menus;
  const reply = command(manifest, "hackl.replyToAnnotationThread");
  assert.equal(reply.title, "Submit");
  assert.equal(reply.icon, "$(arrow-up)");
  assert.deepEqual(menus["comments/commentThread/context"], [
    {
      command: "hackl.replyToAnnotationThread",
      group: "inline@1",
      when: "commentController == hackl.annotations",
    },
  ]);
  assert.deepEqual(menus["comments/commentThread/title"], [
    {
      command: "hackl.resolveAnnotationThread",
      group: "inline@1",
      when: "commentController == hackl.annotations && commentThread == hackl.annotation.open",
    },
  ]);
});

test("codex backend commands and config keys are declared", () => {
  const manifest = readManifest();
  for (const id of ["hackl.selectBackend", "hackl.dismissSetupHint", "hackl.showSetupHint"]) {
    assert.ok(command(manifest, id), `missing command ${id}`);
  }
  const cfg = manifest.contributes.configuration.properties;
  assert.ok(cfg["hackl.codex.enabled"], "missing hackl.codex.enabled");
  assert.ok(cfg["hackl.codex.command"], "missing hackl.codex.command");
  assert.ok(cfg["hackl.codex.model"], "missing hackl.codex.model");
});

test("internal annotation commands stay out of the command palette", () => {
  const manifest = readManifest();
  const hidden = new Set(
    manifest.contributes.menus.commandPalette
      .filter((item) => item.when === "false")
      .map((item) => item.command),
  );
  assert.ok(hidden.has("hackl.replyToAnnotationThread"));
  assert.ok(hidden.has("hackl.deleteAnnotationThread"));
  assert.ok(hidden.has("hackl.resolveAnnotationThread"));
  assert.ok(hidden.has("hackl.revealTarget"));
});
