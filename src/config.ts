import * as vscode from "vscode";

export interface HacklConfig {
  endpoint: string;
  endpointConfigured: boolean;
  maxToolFileChars: number;
  maxContextTokens: number;
  maxContextTokensConfigured: boolean;
  enableThinking: boolean;
  debug: boolean;
  persistSessions: boolean;
  codexEnabled: boolean;
  codexCommand: string;
  codexModel: string;
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
    maxToolFileChars: c.get<number>("maxToolFileChars", DEFAULTS.maxToolFileChars),
    maxContextTokens: c.get<number>("maxContextTokens", DEFAULTS.maxContextTokens),
    maxContextTokensConfigured: hasUserConfigured(c.inspect<number>("maxContextTokens")),
    enableThinking: c.get<boolean>("enableThinking", DEFAULTS.enableThinking),
    debug: c.get<boolean>("debug", DEFAULTS.debug),
    persistSessions: c.get<boolean>("persistSessions", DEFAULTS.persistSessions),
    codexEnabled: c.get<boolean>("codex.enabled", DEFAULTS.codexEnabled),
    codexCommand: (c.get<string>("codex.command", DEFAULTS.codexCommand) || DEFAULTS.codexCommand).trim(),
    codexModel: (c.get<string>("codex.model", DEFAULTS.codexModel) || "").trim(),
  };
}
