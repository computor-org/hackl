import * as vscode from "vscode";

export interface HacklConfig {
  endpoint: string;
  endpointConfigured: boolean;
  model: string;
  maxToolFileChars: number;
  maxContextTokens: number;
  maxContextTokensConfigured: boolean;
  enableThinking: boolean;
  debug: boolean;
  persistSessions: boolean;
  codexEnabled: boolean;
  codexCommand: string;
  codexModel: string;
  autocomplete: AutocompleteConfig;
}

export interface AutocompleteConfig {
  enabled: boolean;
  endpoint: string;
  endpointConfigured: boolean;
  model: string;
  maxTokens: number;
  debounceMs: number;
  multiLine: boolean;
  maxPredictMs: number;
}

const DEFAULTS = {
  maxToolFileChars: 12000,
  maxContextTokens: 32768,
  enableThinking: false,
  debug: false,
  persistSessions: true,
  codexEnabled: true,
  codexCommand: "codex",
  codexModel: "",
  autocompleteEnabled: false,
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
    model: (c.get<string>("model", "") || "").trim(),
    maxToolFileChars: c.get<number>("maxToolFileChars", DEFAULTS.maxToolFileChars),
    maxContextTokens: c.get<number>("maxContextTokens", DEFAULTS.maxContextTokens),
    maxContextTokensConfigured: hasUserConfigured(c.inspect<number>("maxContextTokens")),
    enableThinking: c.get<boolean>("enableThinking", DEFAULTS.enableThinking),
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
  };
}
