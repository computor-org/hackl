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
  for (const id of ["hackl.replyToAnnotationThread", "hackl.deleteAnnotationThread", "hackl.revealTarget"]) {
    assert.equal(command(manifest, id)?.enablement, undefined, `${id} must be invokable from VS Code UI contexts`);
  }
});

test("annotation reply is the only custom comment editor action", () => {
  const manifest = readManifest();
  const menus = manifest.contributes.menus;
  assert.deepEqual(menus["comments/commentThread/context"], [
    {
      command: "hackl.replyToAnnotationThread",
      group: "inline@1",
      when: "commentController == hackl.annotations",
    },
  ]);
  assert.equal(menus["comments/commentThread/title"], undefined);
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
  assert.ok(hidden.has("hackl.revealTarget"));
});
