const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { BasketService } = require("../dist/basket.js");
const { parseAnnotationsFromAnswer } = require("../dist/annotations.js");
const { newHacklSessionId, persistHacklSession } = require("@hackl/core/hacklSession");
const { filterAnnotationsForTargets, resolveTargetIdFor, targetRevealLocation } = require("@hackl/core/targetResolve");

test("resolveTargetIdFor prefers an enclosing range, falls back to same uri", () => {
  const targets = [
    { id: "t-a", kind: "source-range", uri: "file:///x.ts", startLine: 1, endLine: 5 },
    { id: "t-b", kind: "source-range", uri: "file:///x.ts", startLine: 10, endLine: 20 },
    { id: "t-c", kind: "source-range", uri: "file:///y.ts", startLine: 1, endLine: 100 },
  ];
  assert.equal(resolveTargetIdFor({ uri: "file:///x.ts", startLine: 12, endLine: 18 }, targets), "t-b");
  assert.equal(resolveTargetIdFor({ uri: "file:///x.ts", startLine: 30, endLine: 32 }, targets), "t-a");
  assert.equal(resolveTargetIdFor({ uri: "file:///z.ts", startLine: 1, endLine: 1 }, targets), undefined);
});

test("targetRevealLocation opens source ranges and revealable staged files", () => {
  assert.deepEqual(
    targetRevealLocation({
      id: "src-1",
      kind: "source-range",
      uri: "file:///repo/a.ts",
      startLine: 3,
      endLine: 6,
    }),
    { uri: "file:///repo/a.ts", startLine: 3, endLine: 6 },
  );
  assert.deepEqual(
    targetRevealLocation({
      id: "staged-1",
      kind: "staged-changes",
      workspaceRoot: "/repo",
      files: ["src/a.ts", "src/b.ts"],
      metadata: { revealFiles: ["src/a.ts", "src/b.ts"] },
    }),
    { uri: "file:///repo/src/a.ts" },
  );
  assert.deepEqual(
    targetRevealLocation({
      id: "staged-space",
      kind: "staged-changes",
      workspaceRoot: "/repo",
      files: ["src/file with space.ts"],
      metadata: { revealFiles: ["src/file with space.ts"] },
    }),
    { uri: "file:///repo/src/file%20with%20space.ts" },
  );
  assert.deepEqual(
    targetRevealLocation({
      id: "staged-rename",
      kind: "staged-changes",
      workspaceRoot: "/repo",
      files: ["src/new.ts"],
      metadata: { revealFiles: ["src/new.ts"] },
    }),
    { uri: "file:///repo/src/new.ts" },
  );
  assert.equal(
    targetRevealLocation({
      id: "staged-delete",
      kind: "staged-changes",
      workspaceRoot: "/repo",
      files: ["src/deleted.ts"],
      metadata: { revealFiles: [] },
    }),
    undefined,
  );
  assert.equal(
    targetRevealLocation({
      id: "commit-1",
      kind: "commit",
      workspaceRoot: "/repo",
      files: [],
    }),
    undefined,
  );
});

test("filterAnnotationsForTargets keeps only basket-backed annotations", () => {
  const targets = [
    { id: "src", kind: "source-range", uri: "file:///repo/a.ts", startLine: 10, endLine: 20 },
    {
      id: "staged",
      kind: "staged-changes",
      workspaceRoot: "/repo",
      files: ["src/changed.ts", "src/deleted.ts"],
      metadata: {
        annotationLineRanges: [
          { uri: "file:///repo/src/changed.ts", startLine: 1, endLine: 20 },
        ],
      },
    },
  ];
  const result = filterAnnotationsForTargets([
    { uri: "file:///repo/a.ts", startLine: 12, endLine: 13 },
    { uri: "file:///repo/a.ts", startLine: 999999, endLine: 1000000 },
    { uri: "file:///repo/src/changed.ts", startLine: 3, endLine: 4 },
    { uri: "file:///repo/src/changed.ts", startLine: 4, endLine: 1000 },
    { uri: "file:///outside.ts", startLine: 1, endLine: 1 },
  ], targets);
  assert.equal(result.annotations.length, 2);
  assert.equal(result.dropped, 3);
  assert.deepEqual(result.annotations.map((a) => a.targetId), ["src", "staged"]);
});

test("filterAnnotationsForTargets falls back to file URI for diff targets without hunk metadata", () => {
  const result = filterAnnotationsForTargets([
    { uri: "file:///repo/src/changed.ts", startLine: 999999, endLine: 1000000 },
  ], [{
    id: "staged",
    kind: "staged-changes",
    workspaceRoot: "/repo",
    files: ["src/changed.ts"],
  }]);
  assert.equal(result.annotations.length, 1);
  assert.equal(result.dropped, 0);
});

test("parseAnnotationsFromAnswer tags annotations as AI with model", () => {
  const answer = [
    "```hackl-annotations",
    JSON.stringify([{ uri: "file:///a.ts", startLine: 1, endLine: 2, severity: "note", message: "m" }]),
    "```",
  ].join("\n");
  const parsed = parseAnnotationsFromAnswer(answer, undefined, { aiModel: "qwen3" });
  assert.equal(parsed.annotations.length, 1);
  assert.equal(parsed.annotations[0].authorType, "ai");
  assert.equal(parsed.annotations[0].aiModel, "qwen3");
});

test("persistHacklSession writes a JSON file under extension storage sessions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hackl-rs-"));
  try {
    const session = {
      id: newHacklSessionId(),
      createdAt: new Date().toISOString(),
      mode: "ask",
      endpoint: "http://127.0.0.1:1234/v1",
      model: "test",
      targets: [],
      answer: "done",
      annotations: [],
    };
    const file = await persistHacklSession(root, session);
    assert.ok(file && fssync.existsSync(file));
    const written = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(written.id, session.id);
    assert.equal(written.answer, "done");
    assert.match(file, /\/sessions\//);
    assert.doesNotMatch(file, /\.hackl/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
