import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export type CodexAuthMode = "chatgpt" | "apikey" | "none";

export interface CodexDetection {
  available: boolean;
  command: string;
  version?: string;
  authMode: CodexAuthMode;
  models: string[];
  modelContextWindows: Record<string, number>;
  error?: string;
}

export const DEFAULT_CODEX_MODELS: ReadonlyArray<string> = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2",
];

let cached: { key: string; result: Promise<CodexDetection> } | undefined;

export function detectCodex(options: { command?: string; codexHome?: string; force?: boolean } = {}): Promise<CodexDetection> {
  const command = options.command?.trim() || "codex";
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const key = `${command}|${codexHome}`;
  if (!options.force && cached && cached.key === key) {
    return cached.result;
  }
  const result = runDetect(command, codexHome);
  cached = { key, result };
  return result;
}

export function clearCodexDetectionCache(): void {
  cached = undefined;
}

async function runDetect(command: string, codexHome: string): Promise<CodexDetection> {
  const version = await runCodexVersion(command);
  if (!version.ok) {
    return { available: false, command, authMode: "none", models: [], modelContextWindows: {}, error: version.error };
  }
  const authMode = await readAuthMode(codexHome);
  const catalog = await readModelCatalog(version.command ?? command);
  const models = catalog.models.length > 0 ? catalog.models : await readModels(codexHome);
  return {
    available: true,
    command: version.command ?? command,
    version: version.value,
    authMode,
    models,
    modelContextWindows: catalog.modelContextWindows,
  };
}

interface VersionProbe {
  ok: boolean;
  command?: string;
  value?: string;
  error?: string;
}

async function runCodexVersion(command: string): Promise<VersionProbe> {
  const errors: string[] = [];
  for (const candidate of codexCommandCandidates(command)) {
    const probe = await runCodexVersionCandidate(candidate);
    if (probe.ok) return probe;
    if (probe.error) errors.push(`${candidate}: ${probe.error}`);
  }
  return { ok: false, error: errors.join("; ") || "codex not found" };
}

function runCodexVersionCandidate(command: string): Promise<VersionProbe> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (probe: VersionProbe) => {
      if (resolved) return;
      resolved = true;
      resolve(probe);
    };
    let child;
    try {
      child = spawn(command, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (data: Buffer) => chunks.push(data));
    child.stderr?.on("data", (data: Buffer) => chunks.push(data));
    child.on("error", (error) => finish({ ok: false, error: error.message }));
    child.on("close", (code) => {
      if (code !== 0) {
        finish({ ok: false, error: `codex --version exited with code ${code}` });
        return;
      }
      const text = Buffer.concat(chunks).toString("utf8").trim();
      finish({ ok: true, command, value: text || "unknown" });
    });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ ok: false, error: "codex --version timed out" });
    }, 3000);
    child.on("close", () => clearTimeout(timer));
  });
}

export function codexCommandCandidates(command: string, home = os.homedir()): string[] {
  const trimmed = command.trim() || "codex";
  if (trimmed.includes("/") || trimmed.includes("\\")) return [trimmed];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [
    trimmed,
    path.join(home, ".npm-global", "bin", trimmed),
    path.join(home, ".local", "bin", trimmed),
    path.join(home, ".bun", "bin", trimmed),
    path.join(home, ".yarn", "bin", trimmed),
    path.join(home, "node_modules", ".bin", trimmed),
    "/opt/homebrew/bin/" + trimmed,
    "/usr/local/bin/" + trimmed,
  ]) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

async function readAuthMode(codexHome: string): Promise<CodexAuthMode> {
  const authFile = path.join(codexHome, "auth.json");
  try {
    const raw = await fs.readFile(authFile, "utf8");
    const json = JSON.parse(raw) as { auth_mode?: unknown; OPENAI_API_KEY?: unknown };
    const mode = typeof json.auth_mode === "string" ? json.auth_mode.toLowerCase() : "";
    if (mode === "chatgpt" || mode === "apikey") return mode;
    if (typeof json.OPENAI_API_KEY === "string" && json.OPENAI_API_KEY.length > 0) return "apikey";
    return "none";
  } catch {
    return "none";
  }
}

async function readModels(codexHome: string): Promise<string[]> {
  const configFile = path.join(codexHome, "config.toml");
  const fromConfig = await readModelsFromConfig(configFile);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of [...fromConfig, ...DEFAULT_CODEX_MODELS]) {
    const trimmed = m.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

interface CodexModelCatalog {
  models: string[];
  modelContextWindows: Record<string, number>;
}

async function readModelCatalog(command: string): Promise<CodexModelCatalog> {
  const probe = await runCodexJson(command, ["debug", "models"]);
  if (!probe.ok || probe.value === undefined) return { models: [], modelContextWindows: {} };
  return parseCodexModelCatalog(probe.value);
}

function runCodexJson(command: string, args: string[]): Promise<{ ok: boolean; value?: unknown }> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (probe: { ok: boolean; value?: unknown }) => {
      if (resolved) return;
      resolved = true;
      resolve(probe);
    };
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      finish({ ok: false });
      return;
    }
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (data: Buffer) => chunks.push(data));
    child.on("error", () => finish({ ok: false }));
    child.on("close", (code) => {
      if (code !== 0) {
        finish({ ok: false });
        return;
      }
      try {
        finish({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        finish({ ok: false });
      }
    });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ ok: false });
    }, 3000);
    child.on("close", () => clearTimeout(timer));
  });
}

export function parseCodexModelCatalog(value: unknown): CodexModelCatalog {
  const rawModels = value && typeof value === "object" && Array.isArray((value as { models?: unknown }).models)
    ? (value as { models: unknown[] }).models
    : [];
  const models: string[] = [];
  const modelContextWindows: Record<string, number> = {};
  for (const raw of rawModels) {
    if (!raw || typeof raw !== "object") continue;
    const model = raw as Record<string, unknown>;
    const slug = typeof model.slug === "string" ? model.slug : "";
    if (!slug || model.visibility !== "list") continue;
    models.push(slug);
    const contextWindow = positiveInteger(model.context_window);
    const percent = positiveInteger(model.effective_context_window_percent) ?? 100;
    if (contextWindow !== undefined) {
      modelContextWindows[slug] = Math.floor((contextWindow * percent) / 100);
    }
  }
  return { models, modelContextWindows };
}

function positiveInteger(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : undefined;
  return n !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

async function readModelsFromConfig(configFile: string): Promise<string[]> {
  let text: string;
  try {
    text = await fs.readFile(configFile, "utf8");
  } catch {
    return [];
  }
  return parseModelsFromTomlText(text);
}

// Best-effort TOML scan: collect only the top-level Codex model. Profile
// models may point at OpenRouter, local providers, or aliases such as `qwen`;
// Hackl cannot use those unless it also applies the matching Codex profile.
export function parseModelsFromTomlText(text: string): string[] {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) return [];
    const match = /^model\s*=\s*"([^"\n]+)"/.exec(line);
    if (match) return [match[1]];
  }
  return [];
}
