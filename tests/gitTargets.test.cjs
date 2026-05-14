const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

function loadGitTargets() {
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") return { workspace: {} };
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("../dist/gitTargets.js")];
    return require("../dist/gitTargets.js");
  } finally {
    Module._load = original;
  }
}

test("revealFilesFromNameStatus keeps revealable files and skips deleted paths", () => {
  const { revealFilesFromNameStatus } = loadGitTargets();
  const output = [
    "M", "src/modified.ts",
    "A", "src/added.ts",
    "D", "src/deleted.ts",
    "R100", "src/old.ts", "src/new.ts",
    "C075", "src/source.ts", "src/copy.ts",
    "",
  ].join("\0");
  assert.deepEqual(
    revealFilesFromNameStatus(output),
    ["src/modified.ts", "src/added.ts", "src/new.ts", "src/copy.ts"],
  );
});
