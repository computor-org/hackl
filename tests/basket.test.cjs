const assert = require("node:assert/strict");
const test = require("node:test");

const { BasketService, truncate, describeTarget } = require("../dist/basket.js");
const { splitMultiQuestion, buildHacklMessages } = require("../dist/prompt.js");
const { parseReviewCommentsFromAnswer } = require("../dist/reviewComments.js");

function makeSourceTarget(overrides = {}) {
  return {
    id: overrides.id || "src-1",
    addedAt: 1,
    kind: "source-range",
    uri: overrides.uri || "file:///a.ts",
    languageId: "typescript",
    relativePath: "a.ts",
    startLine: overrides.startLine || 1,
    startCharacter: 1,
    endLine: overrides.endLine || 5,
    endCharacter: 1,
    text: "x",
    truncated: false,
  };
}

test("BasketService dedupes identical source-range targets", () => {
  const basket = new BasketService();
  basket.add(makeSourceTarget());
  basket.add(makeSourceTarget());
  assert.equal(basket.list().length, 1);
  basket.add(makeSourceTarget({ id: "src-2", startLine: 10, endLine: 20 }));
  assert.equal(basket.list().length, 2);
});

test("BasketService remove and clear fire change events", () => {
  const basket = new BasketService();
  const events = [];
  basket.onDidChange((snap) => events.push(snap.targets.length));
  basket.add(makeSourceTarget());
  basket.add(makeSourceTarget({ id: "src-2", startLine: 10, endLine: 20 }));
  basket.remove("src-2");
  basket.clear();
  assert.deepEqual(events, [1, 2, 1, 0]);
});

test("truncate caps text and flags truncation", () => {
  assert.deepEqual(truncate("abc", 10), { text: "abc", truncated: false });
  const big = "x".repeat(20);
  assert.deepEqual(truncate(big, 5), { text: "xxxxx", truncated: true });
});

test("describeTarget produces compact labels", () => {
  assert.equal(describeTarget(makeSourceTarget()), "a.ts:1-5");
  assert.equal(
    describeTarget({
      id: "commit-1",
      addedAt: 0,
      kind: "commit",
      workspaceRoot: "/r",
      sha: "deadbeefcafe",
      subject: "fix x",
      files: ["a"],
      diff: "",
      diffTruncated: false,
    }),
    "commit deadbee fix x",
  );
});

test("splitMultiQuestion detects numbered and bulleted lists", () => {
  assert.deepEqual(splitMultiQuestion("just one"), ["just one"]);
  assert.deepEqual(splitMultiQuestion("1. a\n2. b"), ["a", "b"]);
  assert.deepEqual(splitMultiQuestion("- a\n- b"), ["a", "b"]);
  assert.deepEqual(splitMultiQuestion(""), []);
});

test("buildHacklMessages includes targets and questions when supplied", () => {
  const messages = buildHacklMessages(
    "1. is it stable?\n2. is it tested?",
    "ctx",
    [],
    "ask",
    {
      targets: [makeSourceTarget()],
      questions: ["is it stable?", "is it tested?"],
    },
  );
  const body = messages[messages.length - 1].content;
  assert.match(body, /basket:/);
  assert.match(body, /id=src-1 src a\.ts:1-5/);
  assert.match(body, /questions:/);
  assert.match(body, /Q1: is it stable\?/);
  assert.match(body, /Q2: is it tested\?/);
});

test("buildHacklMessages selects review system prompt for review mode", () => {
  const messages = buildHacklMessages("review please", "ctx", [], "review");
  assert.match(messages[0].content, /Local code reviewer/);
  assert.match(messages[0].content, /hackl-review/);
});

test("parseReviewCommentsFromAnswer extracts JSON from fenced blocks", () => {
  const answer = [
    "Looks fine.",
    "```hackl-review",
    JSON.stringify([
      { uri: "file:///x.ts", startLine: 10, endLine: 12, severity: "warning", message: "bounds" },
      { startLine: 4, severity: "note", message: "fallback uri" },
    ]),
    "```",
  ].join("\n");
  const parsed = parseReviewCommentsFromAnswer(answer, "file:///fallback.ts");
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].uri, "file:///x.ts");
  assert.equal(parsed[0].severity, "warning");
  assert.equal(parsed[1].uri, "file:///fallback.ts");
  assert.equal(parsed[1].endLine, 4);
});
