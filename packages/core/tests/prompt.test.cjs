const assert = require("node:assert/strict");
const test = require("node:test");
const { buildHacklMessages } = require("../dist/prompt.js");

test("buildHacklMessages includes system prompt, history, editor context, and request", () => {
  const messages = buildHacklMessages("explain this", "const value = 1;", [
    { role: "user", content: "previous question" },
    { role: "assistant", content: "previous answer" },
  ]);

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /Hackl/);
  assert.match(messages[0].content, /HACKL_TOOL/);
  assert.match(messages[0].content, /No long think/);
  assert.deepEqual(messages.slice(1, 3), [
    { role: "user", content: "previous question" },
    { role: "assistant", content: "previous answer" },
  ]);
  assert.equal(messages[3].role, "user");
  assert.match(messages[3].content, /const value = 1;/);
  assert.match(messages[3].content, /explain this/);
});

test("buildHacklMessages trims history to recent non-empty chat messages", () => {
  const history = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index}`,
  }));

  const messages = buildHacklMessages("current", "", [
    { role: "user", content: " " },
    ...history,
  ]);

  assert.equal(messages.length, 10);
  assert.deepEqual(messages.slice(1, 9).map((message) => message.content), [
    "message 2",
    "message 3",
    "message 4",
    "message 5",
    "message 6",
    "message 7",
    "message 8",
    "message 9",
  ]);
  assert.match(messages[9].content, /\[no editor context\]/);
});

test("buildHacklMessages enables edit tool instructions in edit mode", () => {
  const messages = buildHacklMessages("rename this", "ctx", [], "edit");

  assert.match(messages[0].content, /Local code editor/);
  assert.match(messages[0].content, /replace_text/);
  assert.doesNotMatch(messages[0].content, /No edits/);
});

test("buildHacklMessages enables work instructions in work mode", () => {
  const messages = buildHacklMessages("update call sites", "ctx", [], "work");

  assert.match(messages[0].content, /Local coding worker/);
  assert.match(messages[0].content, /search_files/);
  assert.match(messages[0].content, /No shell commands/);
});

test("buildHacklMessages enables command instructions in agent mode", () => {
  const agent = buildHacklMessages("verify this", "ctx", [], "agent");

  assert.match(agent[0].content, /Local coding agent/);
  assert.match(agent[0].content, /run_command/);
  assert.match(agent[0].content, /workspace-orientation/);
  assert.doesNotMatch(agent[0].content, /skips approval prompts/);
});

test("buildHacklMessages drops the command policy in yolo mode", () => {
  const yolo = buildHacklMessages("clean this up", "ctx", [], "yolo");

  assert.match(yolo[0].content, /unrestricted/);
  assert.match(yolo[0].content, /run_command/);
  assert.match(yolo[0].content, /no approval/);
  assert.match(yolo[0].content, /pipes are allowed/);
});

test("buildHacklMessages formats source and markdown target variants", () => {
  const messages = buildHacklMessages("use targets", "ctx", [], "ask", {
    targets: [
      {
        id: "src-note",
        addedAt: 1,
        kind: "source-range",
        uri: "file:///repo/a.ts",
        languageId: "",
        relativePath: "a.ts",
        startLine: 2,
        startCharacter: 1,
        endLine: 3,
        endCharacter: 1,
        text: "let x = 1;",
        truncated: true,
        metadata: { note: "check this" },
      },
      {
        id: "md-empty-heading",
        addedAt: 1,
        kind: "markdown-section",
        uri: "file:///repo/README.md",
        relativePath: "README.md",
        startLine: 1,
        endLine: 2,
        headingPath: [],
        text: "# Title",
        truncated: true,
      },
    ],
  });
  const body = messages.at(-1).content;
  assert.match(body, /annotation note: check this/);
  assert.match(body, /\.\.\.\(truncated\)/);
  assert.match(body, /md README\.md:1-2 uri=file:\/\/\/repo\/README\.md/);
});

test("buildHacklMessages formats commit target file URI limits", () => {
  const files = Array.from({ length: 21 }, (_, index) => `src/${index}.ts`);
  const messages = buildHacklMessages("review", "ctx", [], "ask", {
    targets: [
      {
        id: "commit-1",
        addedAt: 1,
        kind: "commit",
        workspaceRoot: "/repo",
        sha: "1234567890abcdef",
        subject: "fix",
        files,
        diff: "diff",
        diffTruncated: true,
      },
      {
        id: "commit-empty",
        addedAt: 1,
        kind: "commit",
        workspaceRoot: "/repo",
        sha: "abcdef123456",
        subject: "empty",
        files: [],
        diff: "",
        diffTruncated: false,
      },
    ],
  });
  const body = messages.at(-1).content;
  assert.match(body, /commit 1234567890ab "fix" files=21 truncated=yes workspace=\/repo/);
  assert.match(body, /src\/0\.ts uri=file:\/\/\/repo\/src\/0\.ts/);
  assert.match(body, /fileUris=\[[\s\S]*, \.\.\.\]/);
  assert.match(body, /\.\.\.\(diff truncated\)/);
  assert.match(body, /commit abcdef123456 "empty" files=0 truncated=no workspace=\/repo\n```diff/);
});
