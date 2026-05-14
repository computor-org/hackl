import * as vscode from "vscode";
import { ProbeResult } from "../localServers";
import { renderSetupHtml } from "./setupViewHtml";

type ProbeRunner = () => Promise<ProbeResult[]>;
type EndpointSetter = (endpoint: string) => Promise<void>;

export class SetupPanel {
  static readonly viewType = "hackl.setupPanel";
  private static current: SetupPanel | undefined;

  static show(context: vscode.ExtensionContext, runProbe: ProbeRunner, setEndpoint: EndpointSetter): void {
    if (SetupPanel.current) {
      SetupPanel.current.panel.reveal();
      void SetupPanel.current.postStatus();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      SetupPanel.viewType,
      "Hackl — Setup",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: false },
    );
    SetupPanel.current = new SetupPanel(panel, context, runProbe, setEndpoint);
  }

  static refresh(): void {
    void SetupPanel.current?.postStatus();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    _context: vscode.ExtensionContext,
    private readonly runProbe: ProbeRunner,
    private readonly setEndpoint: EndpointSetter,
  ) {
    panel.webview.html = renderSetupHtml(panel.webview);
    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg?.type) {
        case "ready":
        case "refresh":
          await this.postStatus();
          break;
        case "setEndpoint":
          if (typeof msg.endpoint === "string") {
            await this.setEndpoint(msg.endpoint);
            await this.postStatus();
            vscode.window.showInformationMessage(`Hackl endpoint set to ${msg.endpoint}.`);
          }
          break;
        case "openDoc":
          if (msg.doc === "lmstudio" || msg.doc === "llamacpp" || msg.doc === "ollama") {
            await vscode.commands.executeCommand("hackl.openSetupDoc", msg.doc);
          }
          break;
        case "openLink":
          if (typeof msg.href === "string") {
            await vscode.env.openExternal(vscode.Uri.parse(msg.href));
          }
          break;
      }
    });
    panel.onDidDispose(() => {
      if (SetupPanel.current === this) SetupPanel.current = undefined;
    });
  }

  private profile(): string {
    return vscode.workspace.getConfiguration("hackl").get<string>("setupProfile", "auto");
  }

  private async postStatus(): Promise<void> {
    const probes = await this.runProbe();
    const ok = probes.find((p) => p.ok);
    await this.panel.webview.postMessage({
      type: "status",
      connected: !!ok,
      endpoint: ok?.endpoint,
      model: ok?.model,
      ctx: ok?.ctx,
      profile: this.profile(),
    });
  }
}
