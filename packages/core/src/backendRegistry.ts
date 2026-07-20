import {
  ChatBackend,
  createOpenAICompatibleBackend,
} from "./chatClient";
import { createCodexAppServerBackend } from "./codexBackend";

export type BackendKind = "local" | "codex";

export interface BackendChoice {
  kind: BackendKind;
  model: string;
  endpoint?: string;
}

export interface BuildBackendInput {
  choice: BackendChoice;
  enableThinking?: boolean;
  reasoningBudget?: number;
  // Bearer token for authenticated remote endpoints (local backend only).
  apiKey?: string;
  codexCommand?: string;
  cwd?: string;
  clientVersion?: string;
}

export function buildBackend(input: BuildBackendInput): ChatBackend {
  const { choice } = input;
  if (choice.kind === "codex") {
    return createCodexAppServerBackend({
      command: input.codexCommand,
      model: choice.model,
      cwd: input.cwd,
      clientVersion: input.clientVersion,
    });
  }
  if (!choice.endpoint) {
    throw new Error("Local backend requires an endpoint.");
  }
  return createOpenAICompatibleBackend({
    endpoint: choice.endpoint,
    model: choice.model,
    enableThinking: input.enableThinking,
    reasoningBudget: input.reasoningBudget,
    apiKey: input.apiKey,
  });
}

export function normalizeBackendChoice(value: unknown): BackendChoice | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as { kind?: unknown; model?: unknown; endpoint?: unknown };
  const kind = v.kind === "codex" ? "codex" : v.kind === "local" ? "local" : undefined;
  if (!kind) return undefined;
  const model = typeof v.model === "string" ? v.model : "";
  if (!model) return undefined;
  const endpoint = typeof v.endpoint === "string" ? v.endpoint : undefined;
  return { kind, model, endpoint };
}

export function pickAvailableModel(models: readonly string[], preferred?: string): string | undefined {
  const trimmed = preferred?.trim();
  if (trimmed && models.includes(trimmed)) return trimmed;
  return models[0];
}
