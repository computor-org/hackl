import * as vscode from "vscode";
import { renderChatHtml } from "./chatHtml";
import {
  BasketBridge,
  ChatIncomingMessage,
  ChatOutgoingMessage,
  ChatSession,
  ChatState,
  PromptHandler,
} from "./chatSession";
import { isAllowedWebviewCommand } from "./chatView";

export class ChatPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly session: ChatSession;

  constructor(
    context: vscode.ExtensionContext,
    onPrompt: PromptHandler,
    private readonly getState: () => Promise<ChatState>,
    onDispose: () => void,
    basket?: BasketBridge,
  ) {
    this.session = new ChatSession(onPrompt, basket);
    this.panel = vscode.window.createWebviewPanel(
      "hackl.chatEditor",
      "Hackl Chat",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [context.extensionUri],
      },
    );
    this.panel.webview.html = renderChatHtml(this.panel.webview, context.extensionUri);
    this.panel.webview.onDidReceiveMessage(async (message: ChatIncomingMessage) => {
      if (message.type === "setThinking") {
        await vscode.workspace.getConfiguration("hackl").update("enableThinking", Boolean(message.value), vscode.ConfigurationTarget.Global);
        return;
      }
      if (message.type === "ready") {
        await this.panel.webview.postMessage(await this.getState());
      }
      if (message.type === "runCommand" && typeof message.value === "string" && isAllowedWebviewCommand(message.value)) {
        await vscode.commands.executeCommand(message.value);
        return;
      }
      await this.session.handle(message, (response) => post(this.panel.webview, response));
    });
    this.panel.onDidDispose(() => {
      this.session.dispose();
      onDispose();
    });
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  focusInput(): void {
    void post(this.panel.webview, { type: "focusInput" });
  }
}

async function post(webview: vscode.Webview, message: ChatOutgoingMessage): Promise<boolean> {
  return webview.postMessage(message);
}
