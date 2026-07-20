#!/usr/bin/env node

import { sendChat } from "@hackl/core/chatClient";
import { resolveChatTarget } from "@hackl/core/localServers";

const endpoint = process.argv[2] ?? process.env.HACKL_ENDPOINT ?? "";
const target = await resolveChatTarget({
  endpoint,
  endpointConfigured: endpoint.trim() !== "",
});

const answer = await sendChat([
  { role: "system", content: "Reply with exactly: hackl-smoke-ok" },
  { role: "user", content: "Run a smoke test." },
], target);

if (!answer.toLowerCase().includes("hackl-smoke-ok")) {
  throw new Error(`Smoke response did not contain hackl-smoke-ok: ${answer}`);
}

console.log(`OpenAI-compatible smoke passed: ${target.endpoint} model=${target.model}`);
