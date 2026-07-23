import type { SystemProbe } from "./probe";
import type { ModelOption } from "./catalog";
import { memoryBudgetGB } from "./recommend";
import { configPath } from "./paths";
import { readJsonFile, writeJsonFileAtomic } from "../jsonStore";

export type TriState = "auto" | "on" | "off";

// Resolved llama-server parameters (one launch). Mirrors the knobs in
// slopcode-infra/scripts/server_start_llamacpp.sh.
export interface Knobs {
  host: string;
  port: number;
  context: number;
  nCpuMoe: number;
  ngl: number;
  ubatch?: number;
  batch: number;
  cacheTypeK: string;
  cacheTypeV: string;
  threads?: number;
  threadsHttp?: number;
  reasoningBudget: number;
  parallel: number;
  flashAttn: boolean;
  mtp: boolean;
  specDraftNMax: number;
  mmproj: boolean;
  mmprojOffload: boolean;
  servedAlias: string;
  tensorSplit?: string;
  noMmap: boolean;
  fit: string;
  cacheReuse: number;
}

// Persisted engine block in ~/.config/hackl/config.json. Overrides only; the
// hardware defaults are recomputed every launch so the file stays small and
// adapts when hardware changes.
export interface EngineConfig {
  model?: string;
  host: string;
  port: number;
  mmproj: TriState;
  mtp: TriState;
  overrides: Partial<Knobs>;
  perModel: Record<string, Partial<Knobs>>;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  host: "127.0.0.1",
  port: 8080,
  mmproj: "auto",
  mtp: "auto",
  overrides: {},
  perModel: {},
};

function isMoe(model: ModelOption | undefined): boolean {
  return model?.kind === "moe" || /-a\d+b/.test(model?.alias ?? "");
}

// Compute hardware defaults for a model, then layer global + per-model overrides
// and the mmproj/mtp tri-state choices.
export function resolveKnobs(probe: SystemProbe, model: ModelOption | undefined, cfg: EngineConfig): Knobs {
  const mac = probe.platform === "darwin";
  const budget = memoryBudgetGB(probe);
  const tightVram = (probe.accelerator === "cuda" || probe.accelerator === "rocm") && (probe.vramGB ?? 0) < 12;

  const defaults: Knobs = {
    host: cfg.host || "127.0.0.1",
    port: cfg.port || 8080,
    context: 131072,
    nCpuMoe: !mac && isMoe(model) ? 35 : 0,
    ngl: 99,
    ubatch: mac ? undefined : 1024,
    batch: 2048,
    cacheTypeK: tightVram ? "q4_0" : "q8_0",
    cacheTypeV: tightVram ? "q4_0" : "q8_0",
    threads: mac ? undefined : Math.max(2, probe.cpuCount - 2),
    threadsHttp: mac ? undefined : 4,
    reasoningBudget: 4096,
    parallel: 1,
    flashAttn: true,
    mtp: resolveTri(cfg.mtp, Boolean(model?.mtp), budget - (model?.approxSizeGB ?? 0) >= 1),
    specDraftNMax: 2,
    mmproj: resolveTri(cfg.mmproj, Boolean(model?.mmproj), budget - (model?.approxSizeGB ?? 0) >= 2),
    mmprojOffload: !(mac && probe.totalRamGB < 64),
    servedAlias: "qwen",
    noMmap: false,
    fit: "on",
    cacheReuse: 256,
  };

  return { ...defaults, ...cfg.overrides, ...(model ? cfg.perModel[model.alias] ?? {} : {}) };
}

// Apply one `key value` engine setting in place. Shared by the CLI `/set` and the
// GUI engine panel. Returns a human-readable confirmation; throws on bad input.
export function applyEngineSet(cfg: EngineConfig, key: string, value: string): string {
  const setNum = (k: keyof Knobs): string => {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`invalid number: ${value}`);
    (cfg.overrides as Record<string, number>)[k as string] = n;
    return `${k} = ${n}`;
  };
  const tri = (v: string): TriState => (v === "on" || v === "off" ? v : "auto");
  switch (key) {
    case "model": cfg.model = value; return `model = ${value}`;
    case "host": {
      const h = value === "loopback" || value === "localhost" ? "127.0.0.1" : value === "any" ? "0.0.0.0" : value;
      cfg.host = h;
      return h === "0.0.0.0" ? "host = 0.0.0.0  WARNING: reachable beyond localhost" : `host = ${h}`;
    }
    case "port": cfg.port = Number(value); return `port = ${cfg.port}`;
    case "ctx":
    case "context": return setNum("context");
    case "ngl": return setNum("ngl");
    case "n-cpu-moe": return setNum("nCpuMoe");
    case "threads": return setNum("threads");
    case "kv": cfg.overrides.cacheTypeK = value; cfg.overrides.cacheTypeV = value; return `kv = ${value}`;
    case "mtp": cfg.mtp = tri(value); return `mtp = ${cfg.mtp}`;
    case "mmproj": cfg.mmproj = tri(value); return `mmproj = ${cfg.mmproj}`;
    default: throw new Error(`unknown key: ${key} (model, host, port, ctx, ngl, n-cpu-moe, threads, kv, mtp, mmproj)`);
  }
}

function resolveTri(state: TriState, supported: boolean, autoCondition: boolean): boolean {
  if (!supported) return false;
  if (state === "on") return true;
  if (state === "off") return false;
  return autoCondition;
}

// ---- persistence (engine block of the shared config.json) ----

export function loadEngineConfig(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  const full = readJsonFile<{ engine?: Partial<EngineConfig> }>(configPath(env));
  return { ...DEFAULT_ENGINE_CONFIG, ...(full?.engine ?? {}) };
}

export function saveEngineConfig(mutate: (cfg: EngineConfig) => void, env: NodeJS.ProcessEnv = process.env): EngineConfig {
  const file = configPath(env);
  const full = readJsonFile<Record<string, unknown>>(file) ?? {};
  const current: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, ...((full.engine as Partial<EngineConfig>) ?? {}) };
  mutate(current);
  writeJsonFileAtomic(file, { ...full, engine: current });
  return current;
}
