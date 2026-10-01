const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCoursePolicy, courseAllowsMode, courseCompletion, limitCourseCompletion,
  courseAllowsMcp, courseAllowsRead, runHacklPrompt } = require("../dist/index.js");

const ask = { actionMode: "ask", completion: "off", independentCheck: false };

test("host action ceiling applies independently of completion and always excludes Yolo", () => {
  for (const [ceiling, allowed] of Object.entries({ ask: ["ask"], edit: ["ask", "edit"],
    work: ["ask", "edit", "work"], agent: ["ask", "edit", "work", "agent"] })) {
    const policy = validateCoursePolicy({ ...ask, actionMode: ceiling, completion: "single-line" });
    for (const mode of ["ask", "edit", "work", "agent", "yolo", "invalid"]) {
      assert.equal(courseAllowsMode(policy, mode), allowed.includes(mode));
    }
    assert.equal(courseCompletion(policy), "single-line");
  }
  assert.equal(courseAllowsMode(undefined, "yolo"), true);
});

test("malformed host policies fail validation, never become permissive defaults", () => {
  for (const value of [null, [], {}, { ...ask, actionMode: "yolo" },
    { ...ask, completion: "on" }, { ...ask, independentCheck: "false" }]) {
    assert.throws(() => validateCoursePolicy(value), /Invalid/);
  }
  const copy = validateCoursePolicy(ask);
  assert.notEqual(copy, ask);
  assert.equal(Object.isFrozen(copy), true);
});

test("independent check blocks every action and completion, including review mode", () => {
  const policy = { actionMode: "agent", completion: "multi-line", independentCheck: true };
  for (const mode of ["ask", "edit", "work", "agent", "yolo"]) {
    assert.equal(courseAllowsMode(policy, mode), false);
  }
  assert.equal(limitCourseCompletion("solution\ncontinued", policy), "");
  assert.equal(limitCourseCompletion("one\r\ntwo", { ...ask, completion: "single-line" }), "one");
  assert.equal(limitCourseCompletion("one\ntwo", undefined), "one\ntwo");
  assert.equal(courseAllowsMcp(ask), false);
  assert.equal(courseAllowsMcp(undefined), true);
});

function deps(backend, workspace = {}) {
  return { backend, config: { maxToolFileChars: 1000, maxContextTokens: 8192 },
    workspace: { root: () => "/synthetic-course", ...workspace } };
}
const input = { prompt: "Help me understand this", contextText: "", mode: "ask", coursePolicy: ask };

test("forbidden mode and independent check produce zero provider calls", async () => {
  let calls = 0;
  const d = deps({ complete: async () => { calls++; return { content: "bad" }; } });
  for (const mode of ["edit", "work", "agent", "yolo"]) {
    await assert.rejects(runHacklPrompt(d, { ...input, mode }, () => {}), /disabled/);
  }
  await assert.rejects(runHacklPrompt(d, { ...input,
    coursePolicy: { ...ask, independentCheck: true }, createAnnotations: true }, () => {}), /disabled/);
  assert.equal(calls, 0);
});

test("Ask tutor transports teaching context but rejects model-requested writes", async () => {
  let calls = 0, writes = 0;
  const d = deps({ complete: async (messages) => {
    assert.match(messages[0].content, /Ask a guiding question/);
    if (++calls === 1) return { content: 'HACKL_TOOL {"name":"replace_text","path":"exercise.py","old":"x","new":"solution"}' };
    assert.match(messages.at(-1).content, /only available in Edit/);
    return { content: "What does the variable represent?" };
  } }, { replaceText: async () => { writes++; return { ok: true, content: "changed" }; } });
  const answer = await runHacklPrompt(d, { ...input, teachingPrompt: "Ask a guiding question" }, () => {});
  assert.match(answer.content, /variable/);
  assert.equal(writes, 0);
});

test("a hostile model cannot invoke MCP under a host policy", async () => {
  let calls = 0, mcpCalls = 0, catalogs = 0;
  const d = deps({ complete: async () => {
    calls++;
    return { content: calls === 1 ? 'HACKL_TOOL {"name":"exfiltrate","args":{}}' : "Here is a hint." };
  } });
  d.mcp = { tools: () => { catalogs++; return [{ name: "exfiltrate" }]; },
    toolNames: () => new Set(["exfiltrate"]), callTool: async () => { mcpCalls++; } };
  await runHacklPrompt(d, { ...input, maxToolCalls: 2 }, () => {});
  assert.equal(catalogs, 0);
  assert.equal(mcpCalls, 0);
});

test("course file reads are limited to visible/attached files and exclude secret paths", async () => {
  const allowed = ["exercise.py", ".env", "../outside.py", "nested/.credentials", "nested\\code.py"];
  assert.equal(courseAllowsRead("exercise.py", allowed), true);
  assert.equal(courseAllowsRead("nested/code.py", allowed), true);
  for (const file of [".env", "../outside.py", "nested/.credentials", "not-attached.py", ""]) {
    assert.equal(courseAllowsRead(file, allowed), false);
  }
  let reads = 0, calls = 0;
  const d = deps({ complete: async () => ({ content: ++calls === 1
    ? 'HACKL_TOOL {"name":"read_file","path":".env"}' : "Ask your teacher for a hint." }) },
    { readFile: async () => { reads++; return { ok: true, content: "secret" }; } });
  await runHacklPrompt(d, { ...input, courseReadPaths: allowed }, () => {});
  assert.equal(reads, 0);
});
