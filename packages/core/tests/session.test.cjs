const assert = require("node:assert/strict");
const test = require("node:test");
const { runHacklPrompt, isWorkspaceOrientationPrompt } = require("../dist/session.js");

test("workspace orientation prompts are detected without treating filenames as contents", () => {
  assert.equal(isWorkspaceOrientationPrompt("what is this place?"), true);
  assert.equal(isWorkspaceOrientationPrompt("so list files etc"), true);
  assert.equal(isWorkspaceOrientationPrompt("explain the active document"), false);
});

test("agent orientation preflight lists the workspace before the model answers", async () => {
  const searches = [];
  const calls = [];
  const events = [];
  const answer = await runHacklPrompt(
    {
      backend: {
        async complete(messages) {
          calls.push(messages);
          return { content: "This is the workspace." };
        },
      },
      workspace: {
        root: () => "/repo",
        async searchFiles(request) {
          searches.push(request);
          return { ok: true, content: "README.md: file name match\nsrc/main.ts: file name match" };
        },
        async readFile() { return { ok: true, content: "" }; },
        async replaceText() { return { ok: true, content: "" }; },
      },
      config: { maxToolFileChars: 12000, maxContextTokens: 8192 },
    },
    { prompt: "what is this place?", contextText: "- f1fce.md [active markdown]", mode: "agent", maxToolCalls: 0 },
    (event) => events.push(event),
  );

  assert.equal(answer.content, "This is the workspace.");
  assert.deepEqual(searches, [{ name: "search_files", query: "", glob: "**/*", max_results: 50 }]);
  assert.match(calls[0].at(-1).content, /workspace root: \/repo/);
  assert.match(calls[0].at(-1).content, /README\.md/);
  assert.match(calls[0].at(-1).content, /f1fce\.md/);
  assert.ok(events.some((event) => event.type === "phase" && /Inspecting workspace/.test(event.text)));
});

test("agent orientation reuses the preflight inventory for a repeated empty search", async () => {
  const searches = [];
  let completions = 0;
  const answer = await runHacklPrompt(
    {
      backend: {
        async complete(messages) {
          completions += 1;
          if (completions === 1) {
            return { content: 'HACKL_TOOL {"name":"search_files","query":"","glob":"**/*","max_results":10}' };
          }
          assert.match(messages.at(-1).content, /README\.md/);
          return { content: "This is the workspace." };
        },
      },
      workspace: {
        root: () => "/repo",
        async searchFiles(request) {
          searches.push(request);
          return { ok: true, content: "README.md: file name match\nsrc/main.ts: file name match" };
        },
        async readFile() { return { ok: true, content: "" }; },
        async replaceText() { return { ok: true, content: "" }; },
      },
      config: { maxToolFileChars: 12000, maxContextTokens: 8192 },
    },
    { prompt: "what is this place?", contextText: "", mode: "agent", maxToolCalls: 2 },
    () => {},
  );

  assert.equal(answer.content, "This is the workspace.");
  assert.equal(searches.length, 1);
});

test("a failed tool call is reported as a tool_result event with its reason", async () => {
  const events = [];
  let completions = 0;
  const answer = await runHacklPrompt(
    {
      backend: {
        async complete() {
          completions += 1;
          if (completions === 1) {
            return { content: 'HACKL_TOOL {"name":"read_file","path":"main.py"}' };
          }
          return { content: "That file is missing." };
        },
      },
      workspace: {
        root: () => "/repo",
        async readFile() {
          return { ok: false, content: "ENOENT: no such file or directory, stat 'main.py'\nsecond line" };
        },
        async searchFiles() { return { ok: true, content: "" }; },
        async replaceText() { return { ok: false, content: "not used" }; },
      },
      config: { maxToolFileChars: 12000, maxContextTokens: 8192 },
    },
    { prompt: "read main.py", contextText: "", mode: "ask", maxToolCalls: 4 },
    (event) => events.push(event),
  );

  assert.equal(answer.content, "That file is missing.");
  assert.deepEqual(events.filter((event) => event.type === "tool_result"), [
    {
      type: "tool_result",
      name: "read_file",
      args: "main.py",
      ok: false,
      reason: "ENOENT: no such file or directory, stat 'main.py'",
    },
  ]);
});

test("a successful tool call is reported as an ok tool_result event", async () => {
  const events = [];
  let completions = 0;
  await runHacklPrompt(
    {
      backend: {
        async complete() {
          completions += 1;
          if (completions === 1) {
            return { content: 'HACKL_TOOL {"name":"read_file","path":"main.py"}' };
          }
          return { content: "Read it." };
        },
      },
      workspace: {
        root: () => "/repo",
        async readFile() { return { ok: true, content: "print(1)" }; },
        async searchFiles() { return { ok: true, content: "" }; },
        async replaceText() { return { ok: false, content: "not used" }; },
      },
      config: { maxToolFileChars: 12000, maxContextTokens: 8192 },
    },
    { prompt: "read main.py", contextText: "", mode: "ask", maxToolCalls: 4 },
    (event) => events.push(event),
  );

  assert.deepEqual(events.filter((event) => event.type === "tool_result"), [
    { type: "tool_result", name: "read_file", args: "main.py", ok: true, reason: undefined },
  ]);
});
