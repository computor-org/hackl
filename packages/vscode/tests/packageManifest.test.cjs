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

function configurationProperties(manifest) {
  const sections = Array.isArray(manifest.contributes.configuration)
    ? manifest.contributes.configuration
    : [manifest.contributes.configuration];
  return Object.assign({}, ...sections.map((section) => section.properties));
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

test("comment editor uses native submit keybinding and keeps escape for empty drafts", () => {
  const manifest = readManifest();
  const escape = manifest.contributes.keybindings.find((item) => item.key === "escape" && item.command === "hackl.dismissFocusedEmptyComment");
  assert.equal(manifest.contributes.keybindings.some((item) => item.key === "enter" && /comment/i.test(item.command)), false);
  assert.equal(manifest.contributes.keybindings.some((item) => item.key === "shift+enter" && item.command === "type"), false);
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

test("backend and autocomplete commands and config keys are declared", () => {
  const manifest = readManifest();
  for (const id of ["hackl.selectBackend", "hackl.configureConnection", "hackl.codexLogin", "hackl.toggleAutocomplete", "hackl.clearTrustedEndpoints"]) {
    assert.ok(command(manifest, id), `missing command ${id}`);
  }
  const cfg = configurationProperties(manifest);
  assert.ok(cfg["hackl.codex.enabled"], "missing hackl.codex.enabled");
  assert.ok(cfg["hackl.codex.command"], "missing hackl.codex.command");
  assert.ok(cfg["hackl.codex.model"], "missing hackl.codex.model");
  assert.ok(cfg["hackl.autocomplete.enabled"], "missing hackl.autocomplete.enabled");
  assert.ok(cfg["hackl.autocomplete.endpoint"], "missing hackl.autocomplete.endpoint");
  assert.ok(cfg["hackl.autocomplete.model"], "missing hackl.autocomplete.model");
  assert.ok(cfg["hackl.autocomplete.maxTokens"], "missing hackl.autocomplete.maxTokens");
  assert.ok(cfg["hackl.autocomplete.debounceMs"], "missing hackl.autocomplete.debounceMs");
  assert.ok(cfg["hackl.autocomplete.multiLine"], "missing hackl.autocomplete.multiLine");
  assert.ok(cfg["hackl.autocomplete.maxPredictMs"], "missing hackl.autocomplete.maxPredictMs");
});

test("primary connection settings precede advanced autocomplete overrides", () => {
  const manifest = readManifest();
  const cfg = configurationProperties(manifest);
  const sections = manifest.contributes.configuration;
  assert.deepEqual(
    sections.slice().sort((a, b) => a.order - b.order).map((section) => section.title),
    ["Hackl: Connection", "Hackl: Autocomplete", "Hackl: Agent and Context", "Hackl: Codex", "Hackl: MCP", "Hackl: General"],
  );
  assert.ok(cfg["hackl.endpoint"].order < cfg["hackl.model"].order);
  assert.ok(cfg["hackl.model"].order < cfg["hackl.autocomplete.enabled"].order);
  assert.ok(cfg["hackl.autocomplete.enabled"].order < cfg["hackl.autocomplete.endpoint"].order);
  assert.ok(cfg["hackl.autocomplete.endpoint"].order < cfg["hackl.autocomplete.model"].order);
  assert.match(cfg["hackl.model"].markdownDescription, /edit it here or select it/i);
  assert.match(cfg["hackl.autocomplete.endpoint"].markdownDescription, /Advanced override/);
});

test("welcome walkthrough offers a short local install and two-setting connection path", () => {
  const walkthrough = readManifest().contributes.walkthroughs.find((item) => item.id === "hackl.connect");
  const start = walkthrough.steps.find((step) => step.id === "hackl.walkthrough.pickServer");
  const connect = walkthrough.steps.find((step) => step.id === "hackl.walkthrough.setEndpoint");
  assert.match(start.description, /command:hackl\.engineStart/);
  assert.match(start.description, /LM Studio/);
  assert.match(start.description, /llama\.cpp/);
  assert.match(connect.description, /command:hackl\.configureConnection/);
  assert.match(connect.description, /`\/v1` is optional/);
  assert.match(connect.description, /autocomplete reuses both automatically/);
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
