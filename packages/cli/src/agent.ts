import {
  resolveChatTarget,
  resolveEffectiveContextTokens,
  buildBackend,
  createNodeWorkspaceHost,
  createMcpManager,
  runHacklPrompt,
} from "@hackl/core";
import type {
  HacklConfig,
  McpManager,
  McpServerConfig,
  SessionDeps,
  PromptMode,
  ConversationMessage,
  ApprovalRequest,
  DebugLog,
} from "@hackl/core";
import type { CliArgs } from "./argparse";
import { gatherContext } from "./context";
import { Renderer } from "./render";

export interface AgentContext {
  deps: SessionDeps;
  config: HacklConfig;
  model: string;
  endpoint: string;
  mcp?: McpManager;
  cwd: string;
}

export interface CreateAgentInput {
  config: HacklConfig;
  args: CliArgs;
  cwd: string;
  requestApproval: (request: ApprovalRequest) => Promise<boolean>;
}

export async function createAgentContext(input: CreateAgentInput): Promise<AgentContext> {
  const { config, args, cwd } = input;
  const debug: DebugLog | undefined = config.debug
    ? (event, data) => process.stderr.write(`[hackl] ${event} ${data === undefined ? "" : safeJson(data)}\n`)
    : undefined;

  const target = await resolveChatTarget({
    endpoint: config.endpoint || undefined,
    endpointConfigured: config.endpointConfigured,
    preferredModel: config.model || undefined,
  });

  const backend = args.codex
    ? buildBackend({
        choice: { kind: "codex", model: config.codexModel || config.model || target.model },
        codexCommand: config.codexCommand,
        cwd,
      })
    : buildBackend({
        choice: { kind: "local", model: target.model, endpoint: target.endpoint },
        enableThinking: config.enableThinking,
        reasoningBudget: config.reasoningBudget,
        apiKey: config.apiKey || undefined,
      });

  // A live server context is authoritative. The configured value is only a
  // fallback for endpoints that do not expose their effective context.
  let maxContextTokens = config.maxContextTokens;
  if (!args.codex) {
    maxContextTokens = await resolveEffectiveContextTokens(
      target.endpoint,
      maxContextTokens,
      fetch,
      target.model,
    );
  }

  let mcp: McpManager | undefined;
  const servers = selectServers(config.mcp, args.mcpFilter);
  if (Object.keys(servers).length > 0) {
    mcp = createMcpManager({ debug });
    await mcp.connectAll(servers);
  }

  const deps: SessionDeps = {
    backend,
    workspace: createNodeWorkspaceHost(cwd),
    config: { maxToolFileChars: config.maxToolFileChars, maxContextTokens },
    mcp,
    requestApproval: input.requestApproval,
    debug,
  };

  return { deps, config, model: target.model, endpoint: target.endpoint, mcp, cwd };
}

export interface RunTurnInput {
  prompt: string;
  mode: PromptMode;
  history: ConversationMessage[];
  renderer: Renderer;
  staged?: boolean;
  commit?: string;
  createAnnotations?: boolean;
  signal?: AbortSignal;
}

export async function runTurn(ctx: AgentContext, input: RunTurnInput): Promise<string> {
  const { contextText, targets } = gatherContext({
    cwd: ctx.cwd,
    prompt: input.prompt,
    staged: input.staged,
    commit: input.commit,
  });

  const answer = await runHacklPrompt(
    ctx.deps,
    {
      prompt: input.prompt,
      contextText,
      mode: input.mode,
      targets,
      history: input.history,
      createAnnotations: input.createAnnotations,
      maxToolCalls: ctx.config.maxToolCalls,
      signal: input.signal,
    },
    (event) => input.renderer.handle(event),
  );
  return answer.content;
}

function selectServers(
  all: Record<string, McpServerConfig>,
  filter?: string[],
): Record<string, McpServerConfig> {
  const entries = Object.entries(all ?? {}).filter(([, config]) => config.enabled !== false);
  if (!filter || filter.length === 0) {
    return Object.fromEntries(entries);
  }
  const allow = new Set(filter);
  return Object.fromEntries(entries.filter(([name]) => allow.has(name)));
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
