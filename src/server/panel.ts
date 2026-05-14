import * as vscode from "vscode";
import { ServerManager } from "./manager";
import { renderPanelHtml } from "./panelHtml";
import { openWizard } from "./wizard";

let active: vscode.WebviewPanel | undefined;

export function openManagePanel(context: vscode.ExtensionContext, manager: ServerManager): void {
  if (active) {
    active.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    "hackl.localModel",
    "Hackl: Local model",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  active = panel;
  panel.webview.html = renderPanelHtml(panel.webview);

  const pushStatus = async () => {
    const status = await manager.getStatus();
    panel.webview.postMessage({ type: "status", status });
  };

  const sub = manager.onStatusChanged(() => { void pushStatus(); });

  panel.onDidDispose(() => {
    sub.dispose();
    active = undefined;
  });

  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      switch (msg?.type) {
        case "ready": await pushStatus(); break;
        case "start": await manager.start(); break;
        case "stop": await manager.stop(); break;
        case "restart": await manager.restart(); break;
        case "swap": openWizard(context, manager); break;
        case "logs": manager.logChannel.show(); break;
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Hackl: ${(err as Error).message}`);
    }
  });
}
