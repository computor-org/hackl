import { resolveChatTarget, resolveEffectiveContextTokens, buildBackend } from "@hackl/core";
import type { ChatBackend, SessionConfig } from "@hackl/core";

export interface ServerAgent {
  backend: ChatBackend;
  endpoint: string;
  model: string;
  sessionConfig: SessionConfig;
}

function numberFromEnv(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// Builds the backend + session config from HACKL_* environment variables and
// local-server auto-detection, mirroring the CLI's local backend path. Full
// config-file precedence and a settings UI arrive with the config milestone.
export async function createServerAgent(env: NodeJS.ProcessEnv = process.env): Promise<ServerAgent> {
  const endpoint = env.HACKL_ENDPOINT?.trim() || undefined;
  const apiKey = env.HACKL_API_KEY?.trim() || undefined;
  const model = env.HACKL_MODEL?.trim() || undefined;

  const target = await resolveChatTarget({
    endpoint,
    endpointConfigured: Boolean(endpoint),
    preferredModel: model,
  });

  // A live server context is authoritative; the environment value is only a
  // fallback for endpoints that do not expose their effective context.
  let maxContextTokens = numberFromEnv(env.HACKL_MAX_CONTEXT_TOKENS) ?? 32768;
  maxContextTokens = await resolveEffectiveContextTokens(target.endpoint, maxContextTokens, fetch, target.model);

  const backend = buildBackend({
    choice: { kind: "local", endpoint: target.endpoint, model: target.model },
    enableThinking: false,
    apiKey,
  });

  return {
    backend,
    endpoint: target.endpoint,
    model: target.model,
    sessionConfig: {
      maxToolFileChars: numberFromEnv(env.HACKL_MAX_TOOL_FILE_CHARS) ?? 12000,
      maxContextTokens,
    },
  };
}
