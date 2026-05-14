const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { BasketService } = require("../dist/basket.js");
const { buildHacklMessages } = require("../dist/prompt.js");
const { parseReviewCommentsFromAnswer } = require("../dist/reviewComments.js");
const { newHacklSessionId, persistHacklSession } = require("../dist/hacklSession.js");

test("BasketService carries a generic reviewContext and fires only on change", () => {
  const basket = new BasketService();
  let fires = 0;
  basket.onDidChange(() => fires++);
  basket.setReviewContext({ source: "x", role: "reviewer", externalIds: { a: "1" } });
  basket.setReviewContext({ source: "x", role: "reviewer", externalIds: { a: "1" } });
  basket.setReviewContext({ source: "x", role: "reviewer", externalIds: { a: "2" } });
  basket.setReviewContext(undefined);
  assert.equal(fires, 3);
  assert.equal(basket.getReviewContext(), undefined);
});

test("buildHacklMessages renders a neutral review context block", () => {
  const messages = buildHacklMessages("review", "ctx", [], "ask", {
    reviewContext: {
      source: "external-host",
      role: "reviewer",
      rubricUri: "file:///r.md",
      externalIds: { subject: "abc", artifact: "def" },
      policyHints: { aiLevel: "ask" },
    },
  });
  const body = messages[messages.length - 1].content;
  assert.match(body, /review context:/);
  assert.match(body, /source: external-host/);
  assert.match(body, /reviewer role: reviewer/);
  assert.match(body, /rubric: file:\/\/\/r\.md/);
  assert.match(body, /ids: subject=abc artifact=def/);
  assert.match(body, /policy: aiLevel=ask/);
  assert.doesNotMatch(body, /course|student|tutor|computor/i);
});

test("parseReviewCommentsFromAnswer tags comments as AI with model", () => {
  const answer = [
    "```hackl-review",
    JSON.stringify([{ uri: "file:///a.ts", startLine: 1, endLine: 2, severity: "note", message: "m" }]),
    "```",
  ].join("\n");
  const parsed = parseReviewCommentsFromAnswer(answer, undefined, { aiModel: "qwen3" });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].authorType, "ai");
  assert.equal(parsed[0].aiModel, "qwen3");
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
      context: { source: "external", role: "reviewer" },
      questions: undefined,
      answer: "done",
      comments: [],
    };
    const file = await persistHacklSession(root, session);
    assert.ok(file && fssync.existsSync(file));
    const written = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(written.id, session.id);
    assert.equal(written.context.source, "external");
    assert.match(file, /\.hackl\/sessions\//);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
