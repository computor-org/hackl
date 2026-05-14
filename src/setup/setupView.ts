import * as vscode from "vscode";
import { ProbeResult } from "../localServers";
import { renderSetupHtml } from "./setupViewHtml";

type ProbeRunner = () => Promise<ProbeResult[]>;
type EndpointSetter = (endpoint: string) => Promise<void>;

export class SetupViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "hackl.setupView";

  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly runProbe: ProbeRunner,
    private readonly setEndpoint: EndpointSetter,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = renderSetupHtml(view.webview);
    view.webview.onDidReceiveMessage(async (msg) => {
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
    view.onDidDispose(() => { this.view = undefined; });
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand(`${SetupViewProvider.viewType}.focus`);
  }

  refresh(): void {
    void this.postStatus();
  }

  private profile(): string {
    return vscode.workspace.getConfiguration("hackl").get<string>("setupProfile", "auto");
  }

  private async postStatus(): Promise<void> {
    if (!this.view) return;
    const probes = await this.runProbe();
    const ok = probes.find((p) => p.ok);
    await this.view.webview.postMessage({
      type: "status",
      connected: !!ok,
      endpoint: ok?.endpoint,
      model: ok?.model,
      ctx: ok?.ctx,
      profile: this.profile(),
    });
  }
}
