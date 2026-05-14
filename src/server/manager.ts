import * as vscode from "vscode";
import * as path from "node:path";
import { CATALOG, findModel, ModelEntry } from "./catalog";
import { detectHardware, describeBackend } from "./hardware";
import { HardwareProfile, Recommendation, ModelFit, recommend, fitModel, llamaServerArgs } from "./recommend";
import { installLlamaCpp, ProgressSink } from "./installer";
import { ensureModelDownloaded, inspectModel, ModelFileInfo } from "./modelStore";
import { findFreePort, LlamaServer, ServerPhase } from "./process";
import { detectMaxContextTokens } from "../localServers";

interface PersistedState {
  modelId?: string;
  port?: number;
  binaryPath?: string;
  binaryTag?: string;
  customCtx?: number;
}

const STATE_KEY = "hackl.localServer.v1";

export interface SetupOptions {
  modelId: string;
  ctxOverride?: number;
}

export interface ManagerStatus {
  phase: ServerPhase | "uninitialized";
  detail?: string;
  endpoint?: string;
  modelId?: string;
  modelDisplayName?: string;
  port?: number;
  hardware?: HardwareProfile;
  recommendation?: Recommendation;
  modelFiles?: ModelFileInfo[];
  lastTokensPerSecond?: number;
  actualCtxSize?: number;
}

export class ServerManager {
  private hardware?: HardwareProfile;
  private recommendation?: Recommendation;
  private server?: LlamaServer;
  private state: PersistedState;
  private output: vscode.OutputChannel;
  private lastTps?: number;
  private actualCtxSize?: number;
  private readonly emitter = new vscode.EventEmitter<ManagerStatus>();
  readonly onStatusChanged = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.state = context.globalState.get<PersistedState>(STATE_KEY) ?? {};
    this.output = vscode.window.createOutputChannel("Hackl Local Model");
    this.context.subscriptions.push(this.output, this.emitter);
  }

  get logChannel(): vscode.OutputChannel { return this.output; }

  async refreshHardware(force = false): Promise<HardwareProfile> {
    if (this.hardware && !force) return this.hardware;
    this.hardware = await detectHardware();
    this.recommendation = recommend(this.hardware);
    this.fireStatus();
    return this.hardware;
  }

  async getRecommendation(): Promise<Recommendation> {
    await this.refreshHardware();
    return this.recommendation!;
  }

  async getStatus(): Promise<ManagerStatus> {
    const hardware = this.hardware ?? await this.refreshHardware();
    const recommendation = this.recommendation;
    const modelFiles: ModelFileInfo[] = [];
    const modelsRoot = this.modelsRoot();
    for (const m of CATALOG) {
      modelFiles.push(await inspectModel(modelsRoot, m));
    }
    const model = this.state.modelId ? findModel(this.state.modelId) : undefined;
    return {
      phase: this.server ? this.server.phase : (this.state.modelId ? "stopped" : "uninitialized"),
      endpoint: this.server?.phase === "ready" ? this.server.endpoint : undefined,
      modelId: this.state.modelId,
      modelDisplayName: model?.displayName,
      port: this.state.port,
      hardware,
      recommendation,
      modelFiles,
      lastTokensPerSecond: this.lastTps,
      actualCtxSize: this.actualCtxSize,
    };
  }

  isRunning(): boolean {
    return this.server?.phase === "ready";
  }

  managedEndpoint(): { endpoint: string; model: string } | undefined {
    if (!this.server || this.server.phase !== "ready") return undefined;
    const model = this.state.modelId ? findModel(this.state.modelId) : undefined;
    if (!model) return undefined;
    return { endpoint: this.server.endpoint, model: model.alias };
  }

  async setup(opts: SetupOptions, progress: ProgressSink): Promise<void> {
    const model = findModel(opts.modelId);
    if (!model) throw new Error(`Unknown model: ${opts.modelId}`);
    const hardware = await this.refreshHardware();
    progress.message(`Installing llama.cpp for ${describeBackend(hardware.backend)}...`);
    const installRoot = path.join(this.context.globalStorageUri.fsPath, "llamacpp");
    const install = await installLlamaCpp({ hw: hardware, installRoot, progress });
    progress.message(`Downloading model ${model.displayName}...`);
    await ensureModelDownloaded({ modelsRoot: this.modelsRoot(), model, progress });
    this.state.modelId = model.id;
    this.state.binaryPath = install.binaryPath;
    this.state.binaryTag = install.tag;
    this.state.customCtx = opts.ctxOverride;
    await this.persist();
    progress.message("Starting llama-server...");
    await this.start();
  }

  async start(): Promise<void> {
    if (this.server && (this.server.phase === "ready" || this.server.phase === "starting")) return;
    if (!this.state.modelId || !this.state.binaryPath) {
      throw new Error("Local server not set up. Run \"Hackl: Set up local model\".");
    }
    const model = findModel(this.state.modelId);
    if (!model) throw new Error(`Catalog entry missing for ${this.state.modelId}`);
    const hardware = await this.refreshHardware();
    const fit = fitModel(model, hardware, this.state.customCtx);
    const cfgPort = vscode.workspace.getConfiguration("hackl").get<number>("localServer.port", 8080);
    const port = await findFreePort(cfgPort, cfgPort + 19);
    this.state.port = port;
    const modelPath = path.join(this.modelsRoot(), model.id, model.ggufFile);
    const args = llamaServerArgs(model, fit, modelPath, port);
    this.output.appendLine(`[hackl] launching ${this.state.binaryPath} ${args.join(" ")}`);
    this.lastTps = undefined;
    this.actualCtxSize = undefined;
    const server = new LlamaServer({ binaryPath: this.state.binaryPath, args, port });
    server.on("log", (line) => this.output.appendLine(line));
    server.on("phase", (phase, detail) => {
      this.output.appendLine(`[hackl] phase=${phase}${detail ? ` (${detail})` : ""}`);
      this.fireStatus();
    });
    server.on("tokensPerSecond", (tps: number) => {
      this.lastTps = tps;
      this.fireStatus();
    });
    this.server = server;
    try {
      await server.start();
    } catch (err) {
      this.server = undefined;
      throw err;
    }
    await this.persist();
    void this.verifyCtx(server.endpoint, fit.ctxSize);
  }

  private async verifyCtx(endpoint: string, requested: number): Promise<void> {
    try {
      const actual = await detectMaxContextTokens(endpoint);
      if (actual && Number.isFinite(actual)) {
        this.actualCtxSize = actual;
        if (actual !== requested) {
          this.output.appendLine(`[hackl] context requested ${requested}, server reports ${actual}.`);
        }
        this.fireStatus();
      }
    } catch { /* probe is best-effort */ }
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await server.stop();
    this.server = undefined;
    this.fireStatus();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async swapModel(modelId: string, progress: ProgressSink): Promise<void> {
    await this.stop();
    await this.setup({ modelId }, progress);
  }

  computeFit(modelId: string, ctxOverride?: number): ModelFit | undefined {
    if (!this.hardware) return undefined;
    const model = findModel(modelId);
    if (!model) return undefined;
    return fitModel(model, this.hardware, ctxOverride);
  }

  modelsRoot(): string {
    return path.join(this.context.globalStorageUri.fsPath, "models");
  }

  dispose(): void {
    if (this.server) {
      // best-effort sync stop; deactivate will await
      this.server.stop().catch(() => undefined);
    }
  }

  async waitForStopOnDispose(): Promise<void> {
    if (this.server) await this.server.stop();
  }

  private async persist(): Promise<void> {
    await this.context.globalState.update(STATE_KEY, this.state);
  }

  private fireStatus(): void {
    void this.getStatus().then((s) => this.emitter.fire(s));
  }
}

export function autoStartEnabled(): boolean {
  return vscode.workspace.getConfiguration("hackl").get<boolean>("localServer.autoStart", false);
}

export function hasInitialSetup(context: vscode.ExtensionContext): boolean {
  const state = context.globalState.get<PersistedState>(STATE_KEY);
  return !!(state && state.modelId && state.binaryPath);
}
