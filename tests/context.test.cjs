const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPromptContext } = require("../dist/context.js");

test("buildPromptContext includes active file, cursor, selection, and open file text", () => {
  const context = buildPromptContext([
    {
      fileName: "/tmp/example.ts",
      languageId: "typescript",
      text: "const value = 1;\nconsole.log(value);\n",
      isActive: true,
      cursorLine: 2,
      cursorCharacter: 8,
      selection: "value",
    },
  ], { maxOpenFileChars: 1000 });

  assert.match(context, /File: \/tmp\/example\.ts/);
  assert.match(context, /State: active/);
  assert.match(context, /Cursor: line 2, column 8/);
  assert.match(context, /Selected code:/);
  assert.match(context, /const value = 1;/);
});

test("buildPromptContext truncates long file content", () => {
  const context = buildPromptContext([
    {
      fileName: "/tmp/large.py",
      languageId: "python",
      text: `${"a".repeat(200)}${"b".repeat(200)}`,
      isActive: false,
    },
  ], { maxOpenFileChars: 120 });

  assert.match(context, /characters omitted/);
  assert.ok(context.length < 500);
});
