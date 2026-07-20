import * as vscode from "vscode";
import { normalizeMcpServers, DEFAULT_MAX_TOOL_CALLS } from "@hackl/core";
import type { HacklConfig, AutocompleteConfig } from "@hackl/core";
export type { HacklConfig, AutocompleteConfig } from "@hackl/core";

const DEFAULTS = {
  maxToolFileChars: 12000,
  maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
  maxContextTokens: 32768,
  enableThinking: false,
  reasoningBudget: 4096,
  debug: false,
  persistSessions: true,
  codexEnabled: true,
  codexCommand: "codex",
  codexModel: "",
  autocompleteEnabled: true,
  autocompleteMaxTokens: 48,
  autocompleteDebounceMs: 150,
  autocompleteMultiLine: false,
  autocompleteMaxPredictMs: 400,
};

interface Inspect<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
  globalLanguageValue?: T;
  workspaceLanguageValue?: T;
  workspaceFolderLanguageValue?: T;
}

export function hasUserConfigured<T>(inspection: Inspect<T> | undefined): boolean {
  if (!inspection) return false;
  return [
    inspection.globalValue,
    inspection.workspaceValue,
    inspection.workspaceFolderValue,
    inspection.globalLanguageValue,
    inspection.workspaceLanguageValue,
    inspection.workspaceFolderLanguageValue,
  ].some((value) => value !== undefined && (typeof value !== "string" || value.trim() !== ""));
}

export function readHacklConfig(): HacklConfig {
  const c = vscode.workspace.getConfiguration("hackl");
  return {
    endpoint: (c.get<string>("endpoint", "") || "").trim(),
    endpointConfigured: hasUserConfigured(c.inspect<string>("endpoint")),
    // API keys live in VS Code SecretStorage, never in settings.json. The
    // extension injects the key when it builds the backend; see readApiKey().
    apiKey: "",
    model: (c.get<string>("model", "") || "").trim(),
    maxToolFileChars: c.get<number>("maxToolFileChars", DEFAULTS.maxToolFileChars),
    maxToolCalls: c.get<number>("maxToolCalls", DEFAULTS.maxToolCalls),
    maxContextTokens: c.get<number>("maxContextTokens", DEFAULTS.maxContextTokens),
    maxContextTokensConfigured: hasUserConfigured(c.inspect<number>("maxContextTokens")),
    enableThinking: c.get<boolean>("enableThinking", DEFAULTS.enableThinking),
    reasoningBudget: c.get<number>("reasoningBudget", DEFAULTS.reasoningBudget),
    debug: c.get<boolean>("debug", DEFAULTS.debug),
    persistSessions: c.get<boolean>("persistSessions", DEFAULTS.persistSessions),
    codexEnabled: c.get<boolean>("codex.enabled", DEFAULTS.codexEnabled),
    codexCommand: (c.get<string>("codex.command", DEFAULTS.codexCommand) || DEFAULTS.codexCommand).trim(),
    codexModel: (c.get<string>("codex.model", DEFAULTS.codexModel) || "").trim(),
    autocomplete: {
      enabled: c.get<boolean>("autocomplete.enabled", DEFAULTS.autocompleteEnabled),
      endpoint: (c.get<string>("autocomplete.endpoint", "") || "").trim(),
      endpointConfigured: hasUserConfigured(c.inspect<string>("autocomplete.endpoint")),
      model: (c.get<string>("autocomplete.model", "") || "").trim(),
      maxTokens: c.get<number>("autocomplete.maxTokens", DEFAULTS.autocompleteMaxTokens),
      debounceMs: c.get<number>("autocomplete.debounceMs", DEFAULTS.autocompleteDebounceMs),
      multiLine: c.get<boolean>("autocomplete.multiLine", DEFAULTS.autocompleteMultiLine),
      maxPredictMs: c.get<number>("autocomplete.maxPredictMs", DEFAULTS.autocompleteMaxPredictMs),
    },
    mcp: normalizeMcpServers(c.get<Record<string, unknown>>("mcp", {})),
  };
}
