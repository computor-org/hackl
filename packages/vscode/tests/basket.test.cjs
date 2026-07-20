const assert = require("node:assert/strict");
const test = require("node:test");

const { BasketService, annotationLineRangesFromDiff, createStagedChangesTarget, truncate, describeTarget } = require("../dist/basket.js");
const { buildHacklMessages } = require("@hackl/core/prompt");
const { parseAnnotationsFromAnswer } = require("../dist/annotations.js");

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
      id: "staged-1",
      addedAt: 0,
      kind: "staged-changes",
      workspaceRoot: "/r",
      files: ["a.ts", "b.ts"],
      diff: "",
      diffTruncated: true,
    }),
    "staged diff: 2 files (truncated)",
  );
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
      diffTruncated: true,
    }),
    "commit deadbee fix x (diff truncated)",
  );
});

test("buildHacklMessages includes targets when supplied", () => {
  const messages = buildHacklMessages(
    "explain",
    "ctx",
    [],
    "ask",
    { targets: [makeSourceTarget()] },
  );
  const body = messages[messages.length - 1].content;
  assert.match(body, /basket:/);
  assert.match(body, /id=src-1 src a\.ts:1-5/);
});

test("buildHacklMessages handles staged-diff target", () => {
  const staged = {
    id: "staged-1",
    addedAt: 1,
    kind: "staged-changes",
    workspaceRoot: "/r",
    files: ["a.ts", "b.ts"],
    diff: "diff --git a/a.ts b/a.ts\n@@\n-x\n+y",
    diffTruncated: false,
  };
  const messages = buildHacklMessages("review", "[no editor context]", [], "ask", { targets: [staged] });
  const body = messages[messages.length - 1].content;
  assert.match(body, /staged-diff files=2/);
  assert.match(body, /truncated=no/);
  assert.match(body, /workspace=\/r/);
  assert.match(body, /a\.ts uri=file:\/\/\/r\/a\.ts/);
});

test("createStagedChangesTarget stores visible diff hunk ranges for annotation validation", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,2 +10,4 @@",
    " x",
    "+y",
    "diff --git a/src/deleted.ts b/src/deleted.ts",
    "--- a/src/deleted.ts",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-gone",
  ].join("\n");
  assert.deepEqual(annotationLineRangesFromDiff("/repo", diff), [
    { uri: "file:///repo/src/a.ts", startLine: 10, endLine: 13 },
  ]);
  const target = createStagedChangesTarget({ workspaceRoot: "/repo", files: ["src/a.ts"], diff });
  assert.deepEqual(target.metadata.annotationLineRanges, [
    { uri: "file:///repo/src/a.ts", startLine: 10, endLine: 13 },
  ]);
});

test("buildHacklMessages appends annotation output instructions when createAnnotations is true", () => {
  const messages = buildHacklMessages("explain", "ctx", [], "ask", {
    createAnnotations: true,
  });
  const body = messages[messages.length - 1].content;
  assert.match(body, /annotations requested/);
  assert.match(body, /exactly one fenced block tagged ```hackl-annotations containing JSON only/);
  assert.match(body, /emit \[\]/);
  assert.match(messages[0].content, /Local code helper/);
});

test("parseAnnotationsFromAnswer extracts exact hackl-annotations fenced JSON", () => {
  const answer = [
    "Looks fine.",
    "```hackl-annotations",
    JSON.stringify([
      { uri: "file:///x.ts", startLine: 10, endLine: 12, severity: "warning", message: "bounds" },
      { startLine: 4, severity: "note", message: "fallback uri" },
    ]),
    "```",
  ].join("\n");
  const parsed = parseAnnotationsFromAnswer(answer, "file:///fallback.ts");
  assert.equal(parsed.annotations.length, 2);
  assert.equal(parsed.blocks, 1);
  assert.equal(parsed.parseErrors, 0);
  assert.equal(parsed.annotations[0].uri, "file:///x.ts");
  assert.equal(parsed.annotations[0].severity, "warning");
  assert.equal(parsed.annotations[1].uri, "file:///fallback.ts");
  assert.equal(parsed.annotations[1].endLine, 4);
});

test("parseAnnotationsFromAnswer accepts legacy annotation block tags", () => {
  const answer = [
    "```hackl-review",
    JSON.stringify({ uri: "file:///legacy.ts", start_line: 3, message: "legacy" }),
    "```",
    "```review",
    JSON.stringify({ uri: "file:///review.ts", line: 7, message: "review" }),
    "```",
  ].join("\n");
  const parsed = parseAnnotationsFromAnswer(answer);
  assert.equal(parsed.annotations.length, 2);
  assert.equal(parsed.annotations[0].uri, "file:///legacy.ts");
  assert.equal(parsed.annotations[0].startLine, 3);
  assert.equal(parsed.annotations[1].uri, "file:///review.ts");
  assert.equal(parsed.annotations[1].endLine, 7);
});

test("parseAnnotationsFromAnswer recovers common local-model JSON wrappers", () => {
  const answer = [
    "```hackl-annotations",
    "json",
    JSON.stringify({
      annotations: [
        { uri: "file:///wrapped.ts", startLine: 8, severity: "suggestion", message: "wrapped" },
      ],
    }),
    "```",
    "```hackl-annotations",
    "Here are the annotations:",
    JSON.stringify([{ uri: "file:///prose.ts", line: 2, message: "prose" }]),
    "Done.",
    "```",
  ].join("\n");
  const parsed = parseAnnotationsFromAnswer(answer);
  assert.equal(parsed.parseErrors, 0);
  assert.equal(parsed.annotations.length, 2);
  assert.equal(parsed.annotations[0].uri, "file:///wrapped.ts");
  assert.equal(parsed.annotations[0].severity, "suggestion");
  assert.equal(parsed.annotations[1].uri, "file:///prose.ts");
  assert.equal(parsed.annotations[1].startLine, 2);
});

test("parseAnnotationsFromAnswer reports dropped entries and parse errors", () => {
  const answer = [
    "```hackl-annotations",
    "[{ not valid json",
    "```",
    "```hackl-annotations",
    JSON.stringify([
      { uri: "file:///a.ts", message: "", startLine: 1, endLine: 1 },
      { uri: "file:///a.ts", message: "ok", startLine: 5, endLine: 4 },
      { message: "no uri", startLine: 1, endLine: 1 },
    ]),
    "```",
  ].join("\n");
  const parsed = parseAnnotationsFromAnswer(answer);
  assert.equal(parsed.parseErrors, 1);
  assert.equal(parsed.blocks, 2);
  assert.equal(parsed.annotations.length, 0);
  assert.equal(parsed.dropped.length, 4);
});
