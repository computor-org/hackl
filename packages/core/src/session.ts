import type { ChatBackend, ChatMessage } from "./chatClient";
import type { WorkspaceToolHost } from "./toolRunner";
import { createWorkspaceToolRunner } from "./toolRunner";
import { completeWithTools, ToolLoopAnswer } from "./toolLoop";
import { buildHacklMessages, ConversationMessage, PromptMode } from "./prompt";
import { renderToolCatalog } from "./toolCatalog";
import type { McpManager } from "./mcp/manager";
import type { HacklTarget } from "./types";
import type { ToolResult } from "./tools";
import type { DebugLog } from "./debugLog";

// Approval surfaced to a frontend (terminal y/N, VS Code modal, future HTTP).
export interface ApprovalRequest {
  title: string;
  detail: string;
  approveLabel: string;
  denyLabel: string;
}

// Serializable turn events. A future HTTP/SSE server forwards these verbatim;
// the CLI and VS Code extension render them. Keep every field JSON-plain.
export type SessionEvent =
  | { type: "phase"; text: string }
  | { type: "delta"; channel: "answer" | "reasoning"; text: string }
  | { type: "token_budget"; inputTokens: number; maxContextTokens: number }
  | { type: "done"; content: string; reasoning?: string }
  | { type: "error"; message: string };

export interface SessionConfig {
  maxToolFileChars: number;
  maxContextTokens: number;
}

export interface SessionDeps {
  backend: ChatBackend;
  workspace: WorkspaceToolHost;
  config: SessionConfig;
  mcp?: McpManager;
  requestApproval?: (request: ApprovalRequest) => Promise<boolean>;
  debug?: DebugLog;
}

export interface PromptInput {
  prompt: string;
  contextText: string;
  mode: PromptMode;
  targets?: HacklTarget[];
  history?: ConversationMessage[];
  createAnnotations?: boolean;
  maxToolCalls?: number;
  signal?: AbortSignal;
}

// Default tool-call budget for one turn when nothing overrides it. Configurable
// via the CLI (--max-tool-calls, HACKL_MAX_TOOL_CALLS, config.json) and the
// VS Code hackl.maxToolCalls setting.
export const DEFAULT_MAX_TOOL_CALLS = 128;

interface ModePermissions {
  allowSearch: boolean;
  allowEdits: boolean;
  allowCommands: boolean;
  // Yolo: skip the command policy and per-command approval; run any command.
  yolo: boolean;
}

function permissionsForMode(mode: PromptMode): ModePermissions {
  switch (mode) {
    case "yolo":
      return { allowSearch: true, allowEdits: true, allowCommands: true, yolo: true };
    case "agent":
      return { allowSearch: true, allowEdits: true, allowCommands: true, yolo: false };
    case "work":
      return { allowSearch: true, allowEdits: true, allowCommands: false, yolo: false };
    case "edit":
      return { allowSearch: false, allowEdits: true, allowCommands: false, yolo: false };
    default:
      return { allowSearch: false, allowEdits: false, allowCommands: false, yolo: false };
  }
}

// Run one agent turn. The shared orchestrator used by every frontend: it builds
// the prompt (with the MCP tool catalog), wires built-in + MCP tools through one
// approval gate, drives the tool loop, and streams events to onEvent.
export async function runHacklPrompt(
  deps: SessionDeps,
  input: PromptInput,
  onEvent: (event: SessionEvent) => void,
): Promise<ToolLoopAnswer> {
  const permissions = permissionsForMode(input.mode);
  const mcpTools = deps.mcp?.tools() ?? [];

  const messages: ChatMessage[] = buildHacklMessages(
    input.prompt,
    input.contextText,
    input.history ?? [],
    input.mode,
    {
      targets: input.targets,
      createAnnotations: input.createAnnotations,
      toolCatalog: renderToolCatalog(mcpTools),
    },
  );

  const runTool = createWorkspaceToolRunner({
    maxFileChars: deps.config.maxToolFileChars,
    allowSearch: permissions.allowSearch,
    allowEdits: permissions.allowEdits,
    allowCommands: permissions.allowCommands,
    yolo: permissions.yolo,
    requestApproval: deps.requestApproval,
    workspace: deps.workspace,
    signal: input.signal,
  });

  const extraTools = deps.mcp && mcpTools.length
    ? {
        names: deps.mcp.toolNames(),
        run: (name: string, args: Record<string, unknown>): Promise<ToolResult> =>
          approveThenCallMcp(deps, name, args),
      }
    : undefined;

  try {
    const answer = await completeWithTools({
      backend: deps.backend,
      messages,
      runTool,
      extraTools,
      maxToolCalls: input.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
      maxContextTokens: deps.config.maxContextTokens,
      debug: deps.debug,
      signal: input.signal,
      progress: (event) => {
        if (event.type === "delta") {
          onEvent({ type: "delta", channel: event.channel, text: event.text });
          return;
        }
        if (event.inputTokens !== undefined && event.maxContextTokens !== undefined) {
          onEvent({ type: "token_budget", inputTokens: event.inputTokens, maxContextTokens: event.maxContextTokens });
        }
        onEvent({ type: "phase", text: event.text });
      },
    });
    onEvent({ type: "done", content: answer.content, reasoning: answer.reasoning });
    return answer;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onEvent({ type: "error", message });
    throw error;
  }
}

// MCP tools are untrusted by default: every call goes through the approval gate.
async function approveThenCallMcp(
  deps: SessionDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const detail = `${name}\n\n${summarizeArgs(args)}`;
  const approved = await deps.requestApproval?.({
    title: "Run MCP tool?",
    detail,
    approveLabel: "Run",
    denyLabel: "Deny",
  });
  if (!approved) {
    return { ok: false, content: "MCP tool call denied by user." };
  }
  return deps.mcp!.callTool(name, args);
}

function summarizeArgs(args: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(args);
    return json.length > 500 ? `${json.slice(0, 500)}...` : json;
  } catch {
    return "(unserializable arguments)";
  }
}
