import { probeSystem, type SystemProbe } from "./probe";
import { MODEL_CATALOG, findModel, type ModelOption } from "./catalog";
import { recommendModel, type ModelRecommendation } from "./recommend";
import { loadEngineConfig, saveEngineConfig, resolveKnobs, type EngineConfig } from "./config";
import { resolveServerBin, installManaged, type ResolvedServer } from "./install";
import { modelPath, mmprojPath, isPresent, pullModel } from "./models";
import { startEngine, stopEngine, readEngineState, isAlive, bumpActivity, readActivity, type EngineState } from "./supervisor";
import { detectServer } from "./adopt";

export * from "./probe";
export * from "./catalog";
export * from "./recommend";
export * from "./config";
export * from "./install";
export * from "./models";
export * from "./supervisor";
export * from "./adopt";
export * from "./paths";
export * from "./samplers";

export interface EngineStatus {
  state: "running-managed" | "running-external" | "stopped";
  endpoint?: string;
  model?: string;
  port?: number;
  pid?: number;
}

export interface ModelEntry {
  alias: string;
  present: boolean;
  approxSizeGB: number;
  note?: string;
}

export interface DoctorReport {
  probe: SystemProbe;
  recommendation: ModelRecommendation;
  serverInstalled: boolean;
  serverSource?: string;
  status: EngineStatus;
  models: ModelEntry[];
  notes: string[];
}

export interface StartArgs {
  alias?: string;
  allowDownload?: boolean;
  allowRemote?: boolean;
  log?: (s: string) => void;
}

// Single brain for the managed/adopted local engine, shared by the CLI, the
// VS Code extension host, and the server.
export class EngineManager {
  private probed?: SystemProbe;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async probe(): Promise<SystemProbe> {
    if (!this.probed) this.probed = await probeSystem();
    return this.probed;
  }

  async recommend(): Promise<ModelRecommendation> {
    return recommendModel(await this.probe());
  }

  config(): EngineConfig {
    return loadEngineConfig(this.env);
  }

  setConfig(mutate: (cfg: EngineConfig) => void): EngineConfig {
    return saveEngineConfig(mutate, this.env);
  }

  listModels(): ModelEntry[] {
    return MODEL_CATALOG.map((m) => ({ alias: m.alias, present: isPresent(m, this.env), approxSizeGB: m.approxSizeGB, note: m.note }));
  }

  async status(fetchImpl: typeof fetch = fetch): Promise<EngineStatus> {
    const detected = await detectServer(this.env, fetchImpl);
    if (!detected) return { state: "stopped" };
    const state = readEngineState(this.env);
    return {
      state: detected.managed ? "running-managed" : "running-external",
      endpoint: detected.endpoint,
      model: detected.model,
      port: state?.port,
      pid: detected.managed ? state?.pid : undefined,
    };
  }

  async ensureServer(log: (s: string) => void = () => {}): Promise<ResolvedServer> {
    return (await resolveServerBin(this.env)) ?? installManaged(this.env, log);
  }

  async pull(alias: string, log?: (s: string) => void): Promise<string> {
    const model = findModel(alias);
    if (!model) throw new Error(`unknown model alias: ${alias}`);
    const cfg = this.config();
    return pullModel(model, { withMmproj: cfg.mmproj !== "off" && Boolean(model.mmproj), env: this.env, log });
  }

  private async resolveModel(alias?: string): Promise<ModelOption> {
    const wanted = alias ?? this.config().model;
    if (wanted) {
      const model = findModel(wanted);
      if (!model) throw new Error(`unknown model alias: ${wanted}`);
      return model;
    }
    return (await this.recommend()).primary;
  }

  async start(args: StartArgs = {}): Promise<EngineState> {
    const log = args.log ?? (() => {});
    const current = await this.status();
    if (current.state === "running-external") {
      throw new Error(`an external server is already running at ${current.endpoint}; hackl uses it (not managed). Stop it where it is managed, or pick another port.`);
    }
    if (current.state === "running-managed") {
      return readEngineState(this.env)!;
    }
    const model = await this.resolveModel(args.alias);
    const server = await this.ensureServer(log);
    const cfg = this.config();
    let resolvedModelPath = modelPath(model, this.env);
    if (!resolvedModelPath) {
      if (!args.allowDownload) throw new Error(`model ${model.alias} is not downloaded. Run: hackl pull ${model.alias}`);
      resolvedModelPath = await pullModel(model, { withMmproj: cfg.mmproj !== "off" && Boolean(model.mmproj), env: this.env, log });
    }
    const knobs = resolveKnobs(await this.probe(), model, cfg);
    if (args.allowRemote) knobs.host = "0.0.0.0";
    const mmproj = knobs.mmproj ? mmprojPath(model, this.env) : undefined;
    return startEngine({
      serverBin: server.bin,
      modelPath: resolvedModelPath,
      mmprojPath: mmproj,
      model,
      knobs,
      env: withLib(this.env, server.libDir),
    });
  }

  stop(): boolean {
    return stopEngine(this.env);
  }

  async restart(args: StartArgs = {}): Promise<EngineState> {
    this.stop();
    return this.start(args);
  }

  bumpActivity(): void {
    bumpActivity(this.env);
  }

  // Stop a managed engine that has been idle past the configured threshold.
  maybeAutostop(): boolean {
    const minutes = this.config().autostopIdleMinutes;
    if (!minutes || minutes <= 0) return false;
    const state = readEngineState(this.env);
    if (!state || !isAlive(state.pid)) return false;
    const last = Number(readActivity(this.env) ?? 0);
    if (Date.now() - last < minutes * 60_000) return false;
    return this.stop();
  }

  async doctor(fetchImpl: typeof fetch = fetch): Promise<DoctorReport> {
    const probe = await this.probe();
    const server = await resolveServerBin(this.env);
    const status = await this.status(fetchImpl);
    return {
      probe,
      recommendation: recommendModel(probe),
      serverInstalled: Boolean(server),
      serverSource: server?.source,
      status,
      models: this.listModels(),
      notes: [
        "The 35B-A3B MoE decodes faster than the dense 27B (~3B active params); prefer it when it fits.",
        "At ~16 GB, prefer Qwen 9B over Gemma 12B (fits better, ships FIM tokens, stronger at code).",
      ],
    };
  }
}

function withLib(env: NodeJS.ProcessEnv, libDir?: string): NodeJS.ProcessEnv {
  if (!libDir) return env;
  const prepend = (existing?: string): string => (existing ? `${libDir}:${existing}` : libDir);
  return { ...env, LD_LIBRARY_PATH: prepend(env.LD_LIBRARY_PATH), DYLD_LIBRARY_PATH: prepend(env.DYLD_LIBRARY_PATH) };
}
