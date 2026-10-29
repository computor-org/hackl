const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { parseArgs, ArgError } = require("../dist/argparse.js");

const CLI = path.join(__dirname, "..", "dist", "index.js");
// Unreachable endpoint so a mistaken live run fails fast instead of hanging.
const DEAD_ENV = { ...process.env, HACKL_ENDPOINT: "http://127.0.0.1:1/v1" };
const parserFlags = (source) =>
  new Set([...source.matchAll(/case "(-{1,2}[a-z][a-z0-9-]*)":/g)].map((m) => m[1]));
const helpFlags = (text) =>
  new Set([...text.matchAll(/(?:^|\s)(--?[a-z][a-z0-9-]*)/gm)].map((m) => m[1]));

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

test("recognizes the review subcommand", () => {
  const a = parseArgs(["review", "--staged"]);
  assert.equal(a.command, "review");
  assert.equal(a.staged, true);
});

test("rejects --resume and --session because the CLI stores no sessions", () => {
  assert.throws(() => parseArgs(["--resume", "go"]), ArgError);
  assert.throws(() => parseArgs(["--session", "hs-1", "go"]), ArgError);
  const run = spawnSync(process.execPath, [CLI, "--resume", "--session", "hs-1", "go"],
    { encoding: "utf8", env: DEAD_ENV, input: "", timeout: 20000 });
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /unknown option: --resume/);
});

test("--help lists every option the parser accepts and no others", () => {
  const accepted = parserFlags(fs.readFileSync(path.join(__dirname, "..", "src", "argparse.ts"), "utf8"));
  const help = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8", timeout: 20000 });
  assert.equal(help.status, 0, help.stderr);
  const documented = helpFlags(help.stdout);
  assert.deepEqual([...accepted].filter((flag) => !documented.has(flag)).sort(), []);
  assert.deepEqual([...documented].filter((flag) => !accepted.has(flag)).sort(), []);
});

test("-- stops flag parsing", () => {
  const a = parseArgs(["--mode", "ask", "--", "--not-a-flag"]);
  assert.equal(a.mode, "ask");
  assert.equal(a.prompt, "--not-a-flag");
});
