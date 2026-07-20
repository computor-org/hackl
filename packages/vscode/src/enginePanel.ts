import * as vscode from "vscode";
import { EngineManager, type EngineStatus } from "@hackl/core";

// VS Code surface for the managed/adopted local llama.cpp engine: a status-bar
// item plus commands that drive the shared core EngineManager from the extension
// host. Editor-native (QuickPick + notifications + an output channel) rather than
// a webview; the rich knob panel lives in the shared web UI.
let engine: EngineManager | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let output: vscode.OutputChannel | undefined;

export function registerEngine(context: vscode.ExtensionContext): void {
  engine = new EngineManager();
  output = vscode.window.createOutputChannel("Hackl Engine");
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  statusItem.command = "hackl.engineMenu";
  context.subscriptions.push(statusItem, output);

  context.subscriptions.push(
    vscode.commands.registerCommand("hackl.engineMenu", engineMenu),
    vscode.commands.registerCommand("hackl.engineStart", () => runWithProgress("Starting local engine", (log) => engine!.start({ allowDownload: true, log }))),
    vscode.commands.registerCommand("hackl.engineRestart", () => runWithProgress("Restarting local engine", (log) => engine!.restart({ allowDownload: true, log }))),
    vscode.commands.registerCommand("hackl.engineStop", async () => { engine!.stop(); await refresh(); vscode.window.setStatusBarMessage("Hackl: engine stopped", 3000); }),
    vscode.commands.registerCommand("hackl.engineStatus", async () => vscode.window.showInformationMessage(`Hackl engine: ${describe(await engine!.status())}`)),
    vscode.commands.registerCommand("hackl.engineDoctor", engineDoctor),
    vscode.commands.registerCommand("hackl.selectModel", selectModel),
    vscode.commands.registerCommand("hackl.pullModel", pullModel),
  );

  void refresh();
}

async function refresh(): Promise<void> {
  if (!engine || !statusItem) return;
  try {
    const s = await engine.status();
    statusItem.text =
      s.state === "stopped" ? "$(server) Hackl: off"
        : s.state === "running-managed" ? `$(server-process) Hackl: ${shortModel(s)}`
          : "$(plug) Hackl: external";
    statusItem.tooltip = `${describe(s)}\nClick for engine actions`;
    statusItem.show();
  } catch {
    statusItem.hide();
  }
}

async function engineMenu(): Promise<void> {
  const status = await engine!.status();
  const pick = await vscode.window.showQuickPick(
    [
      { label: "$(play) Start", command: "hackl.engineStart" },
      { label: "$(debug-stop) Stop", command: "hackl.engineStop" },
      { label: "$(refresh) Restart", command: "hackl.engineRestart" },
      { label: "$(list-selection) Select model", command: "hackl.selectModel" },
      { label: "$(cloud-download) Download model", command: "hackl.pullModel" },
      { label: "$(pulse) Doctor", command: "hackl.engineDoctor" },
    ],
    { title: `Hackl engine - ${describe(status)}`, placeHolder: "Engine action" },
  );
  if (pick) await vscode.commands.executeCommand(pick.command);
}

async function selectModel(): Promise<void> {
  const items = engine!.listModels().map((m) => ({
    label: `${m.present ? "$(check) " : "$(cloud) "}${m.alias}`,
    description: `~${m.approxSizeGB} GiB${m.present ? "" : " (download)"}`,
    detail: m.note,
    alias: m.alias,
  }));
  const pick = await vscode.window.showQuickPick(items, { title: "Select local model", placeHolder: "Model to use" });
  if (!pick) return;
  engine!.setConfig((c) => { c.model = pick.alias; });
  vscode.window.setStatusBarMessage(`Hackl: model set to ${pick.alias}`, 3000);
  const status = await engine!.status();
  if (status.state === "running-managed") {
    await runWithProgress(`Switching to ${pick.alias}`, (log) => engine!.restart({ alias: pick.alias, allowDownload: true, log }));
  }
}

async function pullModel(): Promise<void> {
  const items = engine!.listModels().filter((m) => !m.present).map((m) => ({ label: m.alias, description: `~${m.approxSizeGB} GiB`, detail: m.note, alias: m.alias }));
  if (items.length === 0) { vscode.window.showInformationMessage("Hackl: all catalog models are already downloaded."); return; }
  const pick = await vscode.window.showQuickPick(items, { title: "Download a model", placeHolder: "Model to download" });
  if (pick) await runWithProgress(`Downloading ${pick.alias}`, (log) => engine!.pull(pick.alias, log));
}

async function engineDoctor(): Promise<void> {
  const report = await engine!.doctor();
  const p = report.probe;
  output!.clear();
  output!.appendLine(`machine:     ${p.platform}/${p.arch}, ${p.cpuCount} cores, ${p.totalRamGB} GiB RAM`);
  output!.appendLine(`accelerator: ${p.gpuName ?? p.accelerator}${p.vramGB ? ` (${p.vramGB} GiB)` : ""}`);
  output!.appendLine(`engine:      ${report.serverInstalled ? `llama.cpp present (${report.serverSource})` : "not installed (Start will fetch a pinned build)"}`);
  output!.appendLine(`server:      ${describe(report.status)}`);
  output!.appendLine(`recommended: ${report.recommendation.primary.alias} (${report.recommendation.budgetGB} GiB budget)`);
  output!.appendLine(`             ${report.recommendation.reason}`);
  for (const n of report.notes) output!.appendLine(`note: ${n}`);
  output!.show(true);
}

async function runWithProgress(title: string, fn: (log: (s: string) => void) => Promise<unknown>): Promise<void> {
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, async (progress) => {
    try {
      await fn((line) => { output?.appendLine(line); progress.report({ message: line.slice(0, 80) }); });
      await refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Hackl engine: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function describe(s: EngineStatus): string {
  if (s.state === "stopped") return "stopped";
  const tag = s.state === "running-managed" ? "managed" : "external (adopted, read-only)";
  return `running ${tag}: ${s.endpoint ?? ""}${s.model ? ` (${s.model})` : ""}`;
}

function shortModel(s: EngineStatus): string {
  return (s.model ?? "on").split("/").pop() ?? "on";
}
