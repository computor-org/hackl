import { probeSystem, type SystemProbe } from "./probe";
import { MODEL_CATALOG, findModel, type ModelOption } from "./catalog";
import { recommendModel, type ModelRecommendation } from "./recommend";
import { loadEngineConfig, saveEngineConfig, resolveKnobs, type EngineConfig } from "./config";
import { resolveServerBin, installManaged, type ResolvedServer } from "./install";
import { modelPath, mmprojPath, isPresent, pullModel, managedModelSize, removeManagedModel } from "./models";
import { startEngine, readEngineState, type EngineState } from "./supervisor";
import { detectServer } from "./adopt";

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
  hasMmproj: boolean;
  approxSizeGB: number;
  sizeBytes: number;
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

export interface EngineManagerOptions {
  serverBin?: string;
  serverArgs?: string[];
}

// Single brain for the managed/adopted local engine, shared by the CLI, the
// VS Code extension host, and the server.
export class EngineManager {
  private probed?: SystemProbe;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly options: EngineManagerOptions = {},
  ) {}

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
    return MODEL_CATALOG.map((m) => ({
      alias: m.alias,
      present: isPresent(m, this.env),
      hasMmproj: Boolean(m.mmproj),
      approxSizeGB: m.approxSizeGB,
      sizeBytes: managedModelSize(m, this.env),
      note: m.note,
    }));
  }

  removeModel(alias: string): number {
    const model = findModel(alias);
    if (!model) throw new Error(`unknown model alias: ${alias}`);
    const removed = removeManagedModel(model, this.env);
    if (this.config().model === alias) this.setConfig((cfg) => { delete cfg.model; });
    return removed;
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
    if (this.options.serverBin) return { bin: this.options.serverBin, source: "env" };
    return (await resolveServerBin(this.env)) ?? installManaged(this.env, log);
  }

  async pull(alias: string, log?: (s: string) => void, signal?: AbortSignal): Promise<string> {
    const model = findModel(alias);
    if (!model) throw new Error(`unknown model alias: ${alias}`);
    const cfg = this.config();
    return pullModel(model, {
      withMmproj: cfg.mmproj !== "off" && Boolean(model.mmproj),
      env: this.env,
      log,
      signal,
    });
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
    const wantsMmproj = cfg.mmproj !== "off" && Boolean(model.mmproj);
    const missingMmproj = wantsMmproj && !mmprojPath(model, this.env);
    if (!resolvedModelPath || missingMmproj) {
      if (!args.allowDownload) throw new Error(`model ${model.alias} is not downloaded. Run: hackl serve ${model.alias}`);
      resolvedModelPath = await pullModel(model, { withMmproj: wantsMmproj, env: this.env, log });
    }
    const knobs = resolveKnobs(await this.probe(), model, cfg);
    if (args.allowRemote) knobs.host = "0.0.0.0";
    const mmproj = knobs.mmproj ? mmprojPath(model, this.env) : undefined;
    return startEngine({
      serverBin: server.bin,
      serverArgs: this.options.serverArgs,
      modelPath: resolvedModelPath,
      mmprojPath: mmproj,
      model,
      knobs,
      env: withLib(this.env, server.libDir),
    });
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
        "Qwen3.8 27B is the largest catalog model for a 32 GB Mac; use Qwen 9B on ~16 GB machines.",
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
