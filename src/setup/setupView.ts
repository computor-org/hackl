import * as vscode from "vscode";
import { ProbeResult } from "../localServers";
import { CodexDetection } from "../codexDetect";
import { renderSetupHtml } from "./setupViewHtml";

type ProbeRunner = () => Promise<ProbeResult[]>;
type EndpointSetter = (endpoint: string) => Promise<void>;

export interface SetupPanelHooks {
  detectCodex: () => Promise<CodexDetection>;
  useCodex: (model: string) => Promise<void>;
  codexLogin: () => Promise<void>;
  isHintDismissed: () => boolean;
  setHintDismissed: (value: boolean) => Promise<void>;
}

export class SetupPanel {
  static readonly viewType = "hackl.setupPanel";
  private static current: SetupPanel | undefined;

  static show(context: vscode.ExtensionContext, runProbe: ProbeRunner, setEndpoint: EndpointSetter, hooks: SetupPanelHooks): void {
    if (SetupPanel.current) {
      SetupPanel.current.panel.reveal(vscode.ViewColumn.One);
      void SetupPanel.current.postStatus();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      SetupPanel.viewType,
      "Hackl — Setup",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media", "setup")],
      },
    );
    SetupPanel.current = new SetupPanel(panel, context, runProbe, setEndpoint, hooks);
  }

  static refresh(): void {
    void SetupPanel.current?.postStatus();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly runProbe: ProbeRunner,
    private readonly setEndpoint: EndpointSetter,
    private readonly hooks: SetupPanelHooks,
  ) {
    panel.webview.html = renderSetupHtml(panel.webview, context.extensionUri);
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
        case "useCodex":
          if (typeof msg.model === "string" && msg.model) {
            await this.hooks.useCodex(msg.model);
            await this.postStatus();
            vscode.window.showInformationMessage(`Hackl backend set to Codex (${msg.model}).`);
          }
          break;
        case "codexLogin":
          await this.hooks.codexLogin();
          break;
        case "setHintDismissed":
          await this.hooks.setHintDismissed(Boolean(msg.value));
          await this.postStatus();
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
    const [probes, codex] = await Promise.all([
      this.runProbe(),
      this.hooks.detectCodex().catch(() => undefined),
    ]);
    const ok = probes.find((p) => p.ok);
    await this.panel.webview.postMessage({
      type: "status",
      connected: !!ok,
      endpoint: ok?.endpoint,
      model: ok?.model,
      ctx: ok?.ctx,
      profile: this.profile(),
      codex: codex ?? { available: false, command: "codex", authMode: "none", models: [] },
      hintDismissed: this.hooks.isHintDismissed(),
    });
  }
}
