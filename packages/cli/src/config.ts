import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HacklConfig, McpServerConfig } from "@hackl/core";
import { normalizeMcpServers, DEFAULT_MAX_TOOL_CALLS } from "@hackl/core";
import type { CliArgs } from "./argparse";

const DEFAULTS: HacklConfig = {
  endpoint: "",
  endpointConfigured: false,
  apiKey: "",
  model: "",
  maxToolFileChars: 12000,
  maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
  maxContextTokens: 32768,
  maxContextTokensConfigured: false,
  enableThinking: false,
  reasoningBudget: 4096,
  debug: false,
  persistSessions: true,
  codexEnabled: true,
  codexCommand: "codex",
  codexModel: "",
  autocomplete: {
    enabled: false,
    endpoint: "",
    endpointConfigured: false,
    model: "",
    maxTokens: 48,
    debounceMs: 150,
    multiLine: false,
    maxPredictMs: 400,
  },
  mcp: {},
};

export interface LoadConfigInput {
  args: CliArgs;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  readFileImpl?: (file: string) => string | undefined;
}

export function globalConfigPath(homeDir: string, env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CONFIG_HOME?.trim() || path.join(homeDir, ".config");
  return path.join(base, "hackl", "config.json");
}

export function loadCliConfig(input: LoadConfigInput): HacklConfig {
  const env = input.env ?? process.env;
  const homeDir = input.homeDir ?? os.homedir();
  const readFileImpl = input.readFileImpl ?? defaultReadFile;

  const config: HacklConfig = structuredCloneConfig(DEFAULTS);

  applyPartial(config, readJson(readFileImpl(globalConfigPath(homeDir, env))));
  applyPartial(config, readJson(readFileImpl(path.join(input.cwd, ".hackl", "config.json"))));
  applyEnv(config, env);
  applyArgs(config, input.args);

  return config;
}

function applyEnv(config: HacklConfig, env: NodeJS.ProcessEnv): void {
  setString(env.HACKL_ENDPOINT, (v) => { config.endpoint = v; config.endpointConfigured = true; });
  setString(env.HACKL_API_KEY, (v) => { config.apiKey = v; });
  setString(env.HACKL_MODEL, (v) => { config.model = v; });
  setBool(env.HACKL_ENABLE_THINKING, (v) => { config.enableThinking = v; });
  setNumber(env.HACKL_REASONING_BUDGET, (v) => { config.reasoningBudget = v; });
  setNumber(env.HACKL_MAX_CONTEXT_TOKENS, (v) => { config.maxContextTokens = v; config.maxContextTokensConfigured = true; });
  setNumber(env.HACKL_MAX_TOOL_FILE_CHARS, (v) => { config.maxToolFileChars = v; });
  setNumber(env.HACKL_MAX_TOOL_CALLS, (v) => { config.maxToolCalls = v; });
  setBool(env.HACKL_DEBUG, (v) => { config.debug = v; });
  setString(env.HACKL_CODEX_COMMAND, (v) => { config.codexCommand = v; });
}

function applyArgs(config: HacklConfig, args: CliArgs): void {
  if (args.endpoint) { config.endpoint = args.endpoint; config.endpointConfigured = true; }
  if (args.apiKey) { config.apiKey = args.apiKey; }
  if (args.model) { config.model = args.model; }
  if (args.thinking) { config.enableThinking = true; }
  if (args.maxToolCalls !== undefined) { config.maxToolCalls = args.maxToolCalls; }
}

function applyPartial(config: HacklConfig, partial: Record<string, unknown> | undefined): void {
  if (!partial) return;
  setIf(partial.endpoint, "string", (v) => { config.endpoint = v as string; config.endpointConfigured = true; });
  setIf(partial.apiKey, "string", (v) => { config.apiKey = v as string; });
  setIf(partial.model, "string", (v) => { config.model = v as string; });
  setIf(partial.maxToolFileChars, "number", (v) => { config.maxToolFileChars = v as number; });
  setIf(partial.maxToolCalls, "number", (v) => { config.maxToolCalls = v as number; });
  setIf(partial.maxContextTokens, "number", (v) => { config.maxContextTokens = v as number; config.maxContextTokensConfigured = true; });
  setIf(partial.enableThinking, "boolean", (v) => { config.enableThinking = v as boolean; });
  setIf(partial.reasoningBudget, "number", (v) => { config.reasoningBudget = v as number; });
  setIf(partial.debug, "boolean", (v) => { config.debug = v as boolean; });
  setIf(partial.persistSessions, "boolean", (v) => { config.persistSessions = v as boolean; });
  setIf(partial.codexEnabled, "boolean", (v) => { config.codexEnabled = v as boolean; });
  setIf(partial.codexCommand, "string", (v) => { config.codexCommand = v as string; });
  setIf(partial.codexModel, "string", (v) => { config.codexModel = v as string; });
  const mcp = normalizeMcp(partial.mcp);
  if (mcp) config.mcp = { ...config.mcp, ...mcp };
}

// Thin wrapper over the core normalizer: returns undefined when empty so the
// caller can skip the merge.
export function normalizeMcp(value: unknown): Record<string, McpServerConfig> | undefined {
  const out = normalizeMcpServers(value);
  return Object.keys(out).length ? out : undefined;
}

function setIf(value: unknown, type: "string" | "number" | "boolean", apply: (v: unknown) => void): void {
  if (typeof value === type && !(type === "string" && (value as string).trim() === "")) apply(value);
}

function setString(value: string | undefined, apply: (v: string) => void): void {
  if (value && value.trim() !== "") apply(value.trim());
}

function setBool(value: string | undefined, apply: (v: boolean) => void): void {
  if (value === undefined) return;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) apply(true);
  else if (["0", "false", "no", "off"].includes(normalized)) apply(false);
}

function setNumber(value: string | undefined, apply: (v: number) => void): void {
  if (value === undefined) return;
  const n = Number(value);
  if (Number.isFinite(n)) apply(n);
}

function readJson(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function defaultReadFile(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function structuredCloneConfig(config: HacklConfig): HacklConfig {
  return JSON.parse(JSON.stringify(config)) as HacklConfig;
}
