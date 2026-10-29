const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

// Real-model E2E. Skipped unless HACKL_E2E_REAL=1 is set so CI does not require
// a live local server.
const enabled = process.env.HACKL_E2E_REAL === "1";
const endpoint = process.env.HACKL_E2E_ENDPOINT || "http://127.0.0.1:1234/v1";

function stubVscodeForCli() {
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") {
      return {
        Uri: { parse: (s) => ({ toString: () => s }) },
        workspace: { workspaceFolders: undefined, getConfiguration: () => ({ get: () => undefined, inspect: () => undefined }) },
      };
    }
    return original.call(this, request, parent, isMain);
  };
  return () => { Module._load = original; };
}

// Resolve at load time, outside the skipped test, so a broken require fails
// in a normal `npm test` run too.
const restore = stubVscodeForCli();
const { resolveChatTarget } = require("@hackl/core/localServers");
const { createOpenAICompatibleBackend } = require("@hackl/core/chatClient");
const { completeWithTools } = require("@hackl/core/toolLoop");
const { buildHacklMessages } = require("@hackl/core/prompt");
const { createWorkspaceToolRunner } = require("../../dist/workspaceTools.js");
const runTool = createWorkspaceToolRunner({ maxFileChars: 12000, allowEdits: false, allowSearch: false, allowCommands: false });
restore();

test("real model: chat round-trip against a live OpenAI-compatible server", { skip: !enabled }, async () => {
  const target = await resolveChatTarget({
    endpoint,
    endpointConfigured: true,
    preferredModel: process.env.HACKL_E2E_MODEL,
  });
  const messages = buildHacklMessages("Say the word PING and nothing else.", "[no editor context]", [], "ask", {});
  const answer = await completeWithTools({
    // Same wiring as the extension host: the key rides on the backend options.
    backend: createOpenAICompatibleBackend({
      ...target,
      enableThinking: false,
      apiKey: process.env.HACKL_API_KEY,
    }),
    messages,
    runTool,
    maxToolCalls: 0,
    maxContextTokens: 8192,
  });
  assert.ok(typeof answer.content === "string" && answer.content.length > 0, "model returned non-empty content");
});
