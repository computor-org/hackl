import * as vscode from "vscode";
import { CATALOG } from "./catalog";
import { ServerManager } from "./manager";
import { renderWizardHtml } from "./wizardHtml";

let active: vscode.WebviewPanel | undefined;

export function openWizard(context: vscode.ExtensionContext, manager: ServerManager): void {
  if (active) {
    active.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    "hackl.setupWizard",
    "Hackl: Set up local model",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  active = panel;
  panel.webview.html = renderWizardHtml(panel.webview);

  panel.onDidDispose(() => { active = undefined; });

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg?.type === "ready") {
      const status = await manager.getStatus();
      panel.webview.postMessage({
        type: "status",
        status: {
          hardware: status.hardware,
          recommendation: status.recommendation,
          models: CATALOG,
        },
      });
    } else if (msg?.type === "install" && typeof msg.modelId === "string") {
      const post = (m: object) => panel.webview.postMessage(m);
      const sink = {
        message: (text: string) => post({ type: "progress", message: text }),
        fraction: (value: number) => post({ type: "progress", fraction: value }),
      };
      try {
        await manager.setup({ modelId: msg.modelId }, sink);
        post({ type: "done" });
        vscode.window.showInformationMessage(`Hackl local model ready: ${msg.modelId}`);
        panel.dispose();
      } catch (err) {
        post({ type: "progress", message: `Error: ${(err as Error).message}` });
        vscode.window.showErrorMessage(`Hackl setup failed: ${(err as Error).message}`);
      }
    }
  });
}
