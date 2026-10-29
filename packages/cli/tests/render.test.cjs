const assert = require("node:assert/strict");
const test = require("node:test");
const { Renderer, ReportedError } = require("../dist/render.js");

// The Renderer writes straight to the streams; capture both to see what a user
// would actually read in the terminal.
function capture(fn) {
  const out = [];
  const err = [];
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.stdout.write = stdout;
      process.stderr.write = stderr;
    })
    .then(() => ({ out: out.join(""), err: err.join("") }));
}

test("text mode shows a failed tool call with its reason", async () => {
  const renderer = new Renderer({ json: false, color: false, thinking: false });
  const { err } = await capture(() => {
    renderer.handle({ type: "phase", text: "Running tool: read_file main.py" });
    renderer.handle({ type: "tool_result", name: "read_file", args: "main.py", ok: false, reason: "File does not exist" });
    renderer.handle({ type: "tool_result", name: "read_file", args: "ok.py", ok: true, reason: undefined });
  });

  assert.equal(err, "· Running tool: read_file main.py\n· read_file main.py failed: File does not exist\n");
});

test("NDJSON mode carries the tool_result event verbatim", async () => {
  const renderer = new Renderer({ json: true, color: false, thinking: false });
  const { out } = await capture(() => {
    renderer.handle({ type: "tool_result", name: "read_file", args: "main.py", ok: false, reason: "File does not exist" });
  });

  assert.deepEqual(JSON.parse(out.trim()), {
    type: "tool_result",
    name: "read_file",
    args: "main.py",
    ok: false,
    reason: "File does not exist",
  });
});

test("an error event is shown once and marks itself as reported", async () => {
  const renderer = new Renderer({ json: false, color: false, thinking: false });
  const { err } = await capture(() => {
    renderer.handle({ type: "error", message: "Cannot reach http://127.0.0.1:9/v1: connect ECONNREFUSED" });
  });

  assert.equal(err, "error: Cannot reach http://127.0.0.1:9/v1: connect ECONNREFUSED\n");
  assert.equal(renderer.errorShown, true);
  assert.ok(new ReportedError(new Error("shown")) instanceof Error);
});
