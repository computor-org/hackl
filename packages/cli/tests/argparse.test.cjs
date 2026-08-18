const assert = require("node:assert/strict");
const test = require("node:test");
const { parseArgs, ArgError } = require("../dist/argparse.js");

test("defaults to agent mode and treats positionals as the prompt", () => {
  const args = parseArgs(["fix", "the", "bug"]);
  assert.equal(args.mode, "agent");
  assert.equal(args.prompt, "fix the bug");
  assert.equal(args.json, false);
});

test("parses value flags with space and = forms", () => {
  const a = parseArgs(["--mode", "work", "--model=qwen", "--endpoint", "http://x/v1", "hi"]);
  assert.equal(a.mode, "work");
  assert.equal(a.model, "qwen");
  assert.equal(a.endpoint, "http://x/v1");
  assert.equal(a.prompt, "hi");
});

test("--yolo and --mode yolo both select yolo mode", () => {
  assert.equal(parseArgs(["--yolo", "go"]).mode, "yolo");
  assert.equal(parseArgs(["--mode", "yolo", "go"]).mode, "yolo");
});

test("rejects invalid mode and unknown flags", () => {
  assert.throws(() => parseArgs(["--mode", "bogus"]), ArgError);
  assert.throws(() => parseArgs(["--nope"]), ArgError);
  assert.throws(() => parseArgs(["--model"]), ArgError);
});

test("--api-key parses a value alongside a remote --endpoint", () => {
  const a = parseArgs(["--endpoint", "https://openrouter.ai/api/v1", "--api-key", "sk-or-x", "--model", "qwen/qwen3-coder:free", "go"]);
  assert.equal(a.endpoint, "https://openrouter.ai/api/v1");
  assert.equal(a.apiKey, "sk-or-x");
  assert.equal(a.model, "qwen/qwen3-coder:free");
  assert.throws(() => parseArgs(["--api-key"]), ArgError);
});

test("--max-tool-calls parses a positive integer and rejects bad values", () => {
  assert.equal(parseArgs(["--max-tool-calls", "200", "go"]).maxToolCalls, 200);
  assert.equal(parseArgs(["--max-tool-calls=64", "go"]).maxToolCalls, 64);
  assert.equal(parseArgs(["go"]).maxToolCalls, undefined);
  assert.throws(() => parseArgs(["--max-tool-calls", "0"]), ArgError);
  assert.throws(() => parseArgs(["--max-tool-calls", "1.5"]), ArgError);
  assert.throws(() => parseArgs(["--max-tool-calls", "lots"]), ArgError);
  assert.throws(() => parseArgs(["--max-tool-calls"]), ArgError);
});

test("collects repeatable --mcp and boolean flags", () => {
  const a = parseArgs(["--mcp", "helpy", "--mcp", "sloptools", "--json", "--yes", "--staged", "go"]);
  assert.deepEqual(a.mcpFilter, ["helpy", "sloptools"]);
  assert.equal(a.json, true);
  assert.equal(a.yes, true);
  assert.equal(a.staged, true);
});

test("recognizes the minimal local-engine commands", () => {
  const serve = parseArgs(["serve", "qwen3.5-9b-q4", "--open", "--port", "9000"]);
  assert.equal(serve.command, "serve");
  assert.equal(serve.engineArg, "qwen3.5-9b-q4");
  assert.equal(serve.open, true);
  assert.equal(serve.port, 9000);
  assert.equal(parseArgs(["models"]).command, "models");
  const remove = parseArgs(["models", "remove", "qwen3.5-9b-q4", "--yes"]);
  assert.equal(remove.modelsRemove, "qwen3.5-9b-q4");
  assert.equal(remove.yes, true);
  const install = parseArgs(["models", "install", "qwen3.8-27b-q4"]);
  assert.equal(install.modelsInstall, "qwen3.8-27b-q4");
  assert.throws(() => parseArgs(["serve", "one", "two"]), ArgError);
  assert.throws(() => parseArgs(["models", "pull", "one"]), ArgError);
  assert.throws(() => parseArgs(["--open", "explain", "this"]), ArgError);
  // Removed lifecycle words are ordinary prompt text, not hidden aliases.
  assert.equal(parseArgs(["down"]).prompt, "down");
  assert.equal(parseArgs(["explain", "this"]).command, undefined);
});

test("recognizes the review subcommand and resume/session", () => {
  const a = parseArgs(["review", "--staged"]);
  assert.equal(a.command, "review");
  assert.equal(a.staged, true);
  const b = parseArgs(["--resume", "--session", "hs-1", "go"]);
  assert.equal(b.resume, true);
  assert.equal(b.session, "hs-1");
});

test("-- stops flag parsing", () => {
  const a = parseArgs(["--mode", "ask", "--", "--not-a-flag"]);
  assert.equal(a.mode, "ask");
  assert.equal(a.prompt, "--not-a-flag");
});
