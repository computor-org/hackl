const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { BasketService } = require("../dist/basket.js");
const { parseReviewCommentsFromAnswer } = require("../dist/reviewComments.js");
const { newHacklSessionId, persistHacklSession } = require("../dist/hacklSession.js");
const { resolveTargetIdFor } = require("../dist/targetResolve.js");

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


test("parseReviewCommentsFromAnswer tags comments as AI with model", () => {
  const answer = [
    "```hackl-review",
    JSON.stringify([{ uri: "file:///a.ts", startLine: 1, endLine: 2, severity: "note", message: "m" }]),
    "```",
  ].join("\n");
  const parsed = parseReviewCommentsFromAnswer(answer, undefined, { aiModel: "qwen3" });
  assert.equal(parsed.comments.length, 1);
  assert.equal(parsed.comments[0].authorType, "ai");
  assert.equal(parsed.comments[0].aiModel, "qwen3");
});

test("persistHacklSession writes a JSON file under .hackl/sessions/", async () => {
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
      comments: [],
    };
    const file = await persistHacklSession(root, session);
    assert.ok(file && fssync.existsSync(file));
    const written = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(written.id, session.id);
    assert.equal(written.answer, "done");
    assert.match(file, /\.hackl\/sessions\//);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
