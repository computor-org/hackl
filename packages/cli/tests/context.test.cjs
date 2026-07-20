const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileMentions, gatherContext } = require("../dist/context.js");

test("fileMentions parses @path and @path:start-end", () => {
  assert.deepEqual(fileMentions("look at @src/a.ts please"), [{ rel: "src/a.ts", start: undefined, end: undefined }]);
  assert.deepEqual(fileMentions("check @a.ts:10-20 and @b.ts:5"), [
    { rel: "a.ts", start: 10, end: 20 },
    { rel: "b.ts", start: 5, end: undefined },
  ]);
  assert.deepEqual(fileMentions("no mentions here"), []);
});

test("gatherContext turns an @file mention into a source-range target", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-ctx-"));
  fs.writeFileSync(path.join(dir, "a.ts"), "const x = 1;\nconst y = 2;\n");
  const result = gatherContext({ cwd: dir, prompt: "explain @a.ts" });
  assert.match(result.contextText, /workspace:/);
  assert.equal(result.targets.length, 1);
  const target = result.targets[0];
  assert.equal(target.kind, "source-range");
  assert.equal(target.relativePath, "a.ts");
  assert.match(target.text, /const x = 1;/);
});

test("gatherContext ignores @mentions outside the workspace", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hackl-ctx-"));
  const result = gatherContext({ cwd: dir, prompt: "read @../../etc/passwd" });
  assert.equal(result.targets.length, 0);
});
