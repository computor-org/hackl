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

test("real model: chat round-trip against a live OpenAI-compatible server", { skip: !enabled }, async () => {
  const restore = stubVscodeForCli();
  try {
    const { resolveChatTarget } = require("../../dist/localServers.js");
    const { createOpenAICompatibleBackend } = require("../../dist/chatClient.js");
    const { completeWithTools } = require("../../dist/toolLoop.js");
    const { buildHacklMessages } = require("../../dist/prompt.js");
    const { createWorkspaceToolRunner } = require("../../dist/workspaceTools.js");

    const target = await resolveChatTarget({ endpoint, endpointConfigured: true });
    const messages = buildHacklMessages("Say the word PING and nothing else.", "[no editor context]", [], "ask", {});
    const answer = await completeWithTools({
      backend: createOpenAICompatibleBackend({ ...target, enableThinking: false }),
      messages,
      runTool: createWorkspaceToolRunner({ maxFileChars: 12000, allowEdits: false, allowSearch: false, allowCommands: false }),
      maxToolCalls: 0,
      maxContextTokens: 8192,
    });
    assert.ok(typeof answer.content === "string" && answer.content.length > 0, "model returned non-empty content");
  } finally {
    restore();
  }
});
