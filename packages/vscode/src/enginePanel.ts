import * as vscode from "vscode";
import {
  EngineManager,
  EngineSessionLease,
  queryEngineSession,
} from "@hackl/core";
import { readHacklConfig } from "./config";
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
      vscode.commands.registerCommand("hackl.engineStatus", () => this.showStatus()),
      vscode.commands.registerCommand("hackl.selectModel", () => this.selectModel()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("hackl.engine.enabled")
          || event.affectsConfiguration("hackl.endpoint")) {
          void this.reconcile();
        }
      }),
    );
    this.status.show();
    void this.reconcile();
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
    await config.update(ENABLED_SETTING, !enabled, vscode.ConfigurationTarget.Global);
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
  }

  private setStarting(): void {
    this.status.text = "$(loading~spin) Hackl server";
    this.status.tooltip = "Starting the managed llama.cpp session… Click to disable.";
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
      description: `~${model.approxSizeGB} GiB${model.alias === current ? " · preferred" : ""}`,
      detail: model.note,
      alias: model.alias,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      title: "Select local model for the next Hackl server",
      placeHolder: "The active owner is never restarted",
    });
    if (!pick) return;
    this.engine.setConfig((config) => { config.model = pick.alias; });
    const active = await queryEngineSession();
    const suffix = active ? " It applies after the current owner exits." : "";
    vscode.window.showInformationMessage(`Hackl local model set to ${pick.alias}.${suffix}`);
    if (!active && this.shouldManage()) await this.reconcile();
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
