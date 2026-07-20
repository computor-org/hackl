const assert = require("node:assert/strict");
const test = require("node:test");
const { loadCliConfig, normalizeMcp } = require("../dist/config.js");
const { parseArgs } = require("../dist/argparse.js");

function load({ files = {}, env = {}, argv = [] } = {}) {
  return loadCliConfig({
    args: parseArgs(argv),
    cwd: "/tmp/project",
    env,
    homeDir: "/home/u",
    readFileImpl: (file) => files[file],
  });
}

test("applies defaults when nothing is configured", () => {
  const config = load();
  assert.equal(config.endpoint, "");
  assert.equal(config.endpointConfigured, false);
  assert.equal(config.maxContextTokens, 32768);
  assert.equal(config.maxToolCalls, 128);
  assert.equal(config.apiKey, "");
  assert.deepEqual(config.mcp, {});
});

test("apiKey precedence: file < env < flag", () => {
  const fromFile = load({ files: { "/tmp/project/.hackl/config.json": JSON.stringify({ apiKey: "file-key" }) } });
  assert.equal(fromFile.apiKey, "file-key");

  const fromEnv = load({
    files: { "/tmp/project/.hackl/config.json": JSON.stringify({ apiKey: "file-key" }) },
    env: { HACKL_API_KEY: "env-key" },
  });
  assert.equal(fromEnv.apiKey, "env-key");

  const fromFlag = load({ env: { HACKL_API_KEY: "env-key" }, argv: ["--api-key", "flag-key"] });
  assert.equal(fromFlag.apiKey, "flag-key");
});

test("maxToolCalls precedence: file < env < flag", () => {
  const fromFile = load({ files: { "/tmp/project/.hackl/config.json": JSON.stringify({ maxToolCalls: 50 }) } });
  assert.equal(fromFile.maxToolCalls, 50);

  const fromEnv = load({
    files: { "/tmp/project/.hackl/config.json": JSON.stringify({ maxToolCalls: 50 }) },
    env: { HACKL_MAX_TOOL_CALLS: "70" },
  });
  assert.equal(fromEnv.maxToolCalls, 70);

  const fromFlag = load({ env: { HACKL_MAX_TOOL_CALLS: "70" }, argv: ["--max-tool-calls", "90"] });
  assert.equal(fromFlag.maxToolCalls, 90);
});

test("precedence: global file < project file < env < args", () => {
  const config = load({
    files: {
      "/home/u/.config/hackl/config.json": JSON.stringify({ model: "global", maxToolFileChars: 100 }),
      "/tmp/project/.hackl/config.json": JSON.stringify({ model: "project" }),
    },
    env: { HACKL_MODEL: "env" },
    argv: ["--model", "flag"],
  });
  assert.equal(config.model, "flag");
  assert.equal(config.maxToolFileChars, 100);

  const noFlag = load({
    files: { "/tmp/project/.hackl/config.json": JSON.stringify({ model: "project" }) },
    env: { HACKL_MODEL: "env" },
  });
  assert.equal(noFlag.model, "env");
});

test("endpoint from env marks endpointConfigured", () => {
  const config = load({ env: { HACKL_ENDPOINT: "http://x/v1" } });
  assert.equal(config.endpoint, "http://x/v1");
  assert.equal(config.endpointConfigured, true);
});

test("normalizes local and remote MCP servers and drops invalid ones", () => {
  const mcp = normalizeMcp({
    helpy: { command: ["helpy", "mcp-stdio"] },
    remote: { url: "https://mcp.example/v1", headers: { Authorization: "Bearer x" } },
    bad: { type: "local" },
  });
  assert.equal(mcp.helpy.type, "local");
  assert.deepEqual(mcp.helpy.command, ["helpy", "mcp-stdio"]);
  assert.equal(mcp.remote.type, "remote");
  assert.equal(mcp.remote.url, "https://mcp.example/v1");
  assert.equal(mcp.bad, undefined);
});

test("reads mcp from the config file into HacklConfig", () => {
  const config = load({
    files: {
      "/tmp/project/.hackl/config.json": JSON.stringify({ mcp: { helpy: { command: ["helpy", "mcp-stdio"] } } }),
    },
  });
  assert.equal(config.mcp.helpy.type, "local");
});
