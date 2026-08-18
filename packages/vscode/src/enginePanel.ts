import * as vscode from "vscode";
import {
  EngineManager,
  EngineSessionLease,
  queryEngineSession,
} from "@hackl/core";
import { readHacklConfig } from "./config";
import { updateEngineEnabled } from "./engineSetting";
import { engineStatusDisplay } from "./engineStatus";

const ENABLED_SETTING = "engine.enabled";
let controller: EngineController | undefined;

export function registerEngine(context: vscode.ExtensionContext): void {
  controller = new EngineController(context);
  controller.register();
}

export async function deactivateEngine(): Promise<void> {
  await controller?.dispose();
  controller = undefined;
}

export async function ensureEngineReady(): Promise<void> {
  await controller?.ensure();
}

class EngineController {
  private readonly engine = new EngineManager();
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  private readonly output = vscode.window.createOutputChannel("Hackl Engine");
  private lease?: EngineSessionLease;
  private starting?: Promise<void>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.status.command = "hackl.toggleEngine";
  }

  register(): void {
    this.context.subscriptions.push(
      this.status,
      this.output,
      vscode.commands.registerCommand("hackl.toggleEngine", () => this.toggle()),
      vscode.commands.registerCommand("hackl.startEngine", () => this.start()),
      vscode.commands.registerCommand("hackl.engineStatus", () => this.showStatus()),
      vscode.commands.registerCommand("hackl.selectModel", () => this.selectModel()),
      vscode.commands.registerCommand("hackl.downloadModel", () => this.downloadModel()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("hackl.engine.enabled")
          || event.affectsConfiguration("hackl.endpoint")) {
          void this.reconcile();
        }
      }),
    );
    this.status.show();
    // Inspect state on activation, but do not download or start a model until
    // chat, autocomplete, or the explicit start command needs the engine.
    void this.refresh();
  }

  async dispose(): Promise<void> {
    await this.lease?.release();
    this.lease = undefined;
  }

  async ensure(): Promise<void> {
    await this.reconcile();
  }

  private async toggle(): Promise<void> {
    const config = vscode.workspace.getConfiguration("hackl");
    const enabled = config.get<boolean>(ENABLED_SETTING, true);
    const result = await updateEngineEnabled(
      enabled,
      (next) => config.update(ENABLED_SETTING, next, vscode.ConfigurationTarget.Global),
    );
    if (result !== "reload-required") return;
    const action = await vscode.window.showWarningMessage(
      "Reload VS Code to finish updating Hackl.",
      "Reload Window",
    );
    if (action === "Reload Window") {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
  }

  private async start(): Promise<void> {
    if (readHacklConfig().endpointConfigured) {
      vscode.window.showInformationMessage("Hackl is using the configured external endpoint.");
      return;
    }
    await this.reconcile();
  }

  private async reconcile(): Promise<void> {
    if (!this.shouldManage()) {
      await this.dispose();
      await this.refresh();
      return;
    }
    if (!this.lease && !this.starting) {
      this.starting = this.acquire().finally(() => { this.starting = undefined; });
      await this.starting;
    }
    await this.refresh();
  }

  private async acquire(): Promise<void> {
    this.setStarting();
    try {
      const acquired = await EngineSessionLease.acquire({
        kind: "vscode",
        hostCommand: {
          command: process.execPath,
          args: [this.context.asAbsolutePath("dist/engine-host.js")],
          options: {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          },
        },
        log: (text) => this.output.appendLine(text),
      });
      if (!this.shouldManage()) {
        await acquired.release();
        return;
      }
      this.lease = acquired;
    } catch (error) {
      this.output.appendLine(`error: ${message(error)}`);
      vscode.window.showErrorMessage(`Hackl local server: ${message(error)}`);
    }
  }

  private shouldManage(): boolean {
    if (process.env.HACKL_TEST_DISABLE_ENGINE === "1") return false;
    const enabled = vscode.workspace.getConfiguration("hackl").get<boolean>(ENABLED_SETTING, true);
    return enabled && !readHacklConfig().endpointConfigured;
  }

  private async refresh(): Promise<void> {
    const enabled = vscode.workspace.getConfiguration("hackl").get<boolean>(ENABLED_SETTING, true);
    const external = readHacklConfig().endpointConfigured;
    let session = external ? undefined : await queryEngineSession();
    if (!session && enabled && !external) {
      const detected = await this.engine.status();
      if (detected.state === "running-external") {
        session = {
          state: "running-external",
          hostMode: "leased",
          endpoint: detected.endpoint,
          model: detected.model,
          leases: 0,
        };
      }
    }
    const display = engineStatusDisplay(enabled, external, session);
    this.status.text = display.text;
    this.status.tooltip = display.tooltip;
    this.status.command = enabled && !external && (!session || session.state === "stopped")
      ? "hackl.startEngine"
      : "hackl.toggleEngine";
  }

  private setStarting(): void {
    this.status.text = "$(loading~spin) Hackl server";
    this.status.tooltip = "Starting the managed llama.cpp session… Click to disable.";
    this.status.command = "hackl.toggleEngine";
  }

  private async showStatus(): Promise<void> {
    const status = await queryEngineSession();
    if (!status) {
      vscode.window.showInformationMessage("Hackl local server: not running.");
      return;
    }
    vscode.window.showInformationMessage(
      `Hackl local server: ${status.alias ?? status.model ?? status.state} · owner ${status.owner ?? "external"} · ${status.leases} client(s).`,
    );
  }

  private async selectModel(): Promise<void> {
    const current = this.engine.config().model;
    const items = this.engine.listModels().map((model) => ({
      label: `${model.present ? "$(check) " : "$(cloud) "}${model.alias}`,
      description: `${model.present ? "installed" : "not installed"} · ~${model.approxSizeGB} GiB${model.alias === current ? " · preferred" : ""}`,
      detail: model.note,
      alias: model.alias,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      title: "Select local model for the next Hackl server",
      placeHolder: "The active owner is never restarted",
    });
    if (!pick) return;
    await this.useModel(pick.alias);
  }

  private async downloadModel(): Promise<void> {
    const items = this.engine.listModels().map((model) => ({
      label: `${model.present ? "$(check) " : "$(cloud-download) "}${model.alias}`,
      description: `${model.present ? "already downloaded" : "download"} · ~${model.approxSizeGB} GiB`,
      detail: model.hasMmproj ? `${model.note ?? ""} Includes the vision projector.`.trim() : model.note,
      alias: model.alias,
      present: model.present,
      hasMmproj: model.hasMmproj,
      approxSizeGB: model.approxSizeGB,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      title: "Hackl: Download a local model",
      placeHolder: "Choose a model to cache locally",
      matchOnDescription: true,
    });
    if (!pick) return;
    if (pick.present) {
      await this.offerUseModel(pick.alias, "already downloaded");
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Download ${pick.alias} (~${pick.approxSizeGB} GiB)?`,
      {
        modal: true,
        detail: `Hackl will download the GGUF weights${pick.hasMmproj ? " and vision projector" : ""} from Hugging Face. You can cancel while it is running.`,
      },
      "Download",
    );
    if (confirmed !== "Download") return;

    const controller = new AbortController();
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Hackl: Downloading ${pick.alias}`,
          cancellable: true,
        },
        async (progress, token) => {
          const cancellation = token.onCancellationRequested(() => controller.abort());
          try {
            await this.engine.pull(pick.alias, (text) => {
              this.output.appendLine(text);
              progress.report({ message: downloadProgressMessage(text) });
            }, controller.signal);
          } finally {
            cancellation.dispose();
          }
        },
      );
      await this.offerUseModel(pick.alias, "downloaded");
    } catch (error) {
      if (controller.signal.aborted) {
        vscode.window.showInformationMessage(`Hackl: download of ${pick.alias} cancelled.`);
        return;
      }
      this.output.appendLine(`download error: ${message(error)}`);
      vscode.window.showErrorMessage(`Hackl model download failed: ${message(error)}`);
    }
  }

  private async offerUseModel(alias: string, state: string): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      `Hackl: ${alias} is ${state}.`,
      "Use for next start",
    );
    if (action === "Use for next start") await this.useModel(alias);
  }

  private async useModel(alias: string): Promise<void> {
    this.engine.setConfig((config) => { config.model = alias; });
    const active = await queryEngineSession();
    const suffix = active ? " It applies after the current owner exits." : " Start the managed server when you are ready.";
    vscode.window.showInformationMessage(`Hackl local model set to ${alias}.${suffix}`);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function downloadProgressMessage(text: string): string {
  const percent = text.match(/(\d{1,3})%/);
  if (percent) return `${percent[1]}%`;
  const compact = text.trim();
  return compact.length > 90 ? `${compact.slice(0, 87)}...` : compact;
}
