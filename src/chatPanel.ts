import * as vscode from "vscode";
import { renderChatHtml } from "./chatHtml";
import { ChatAnswer, ChatIncomingMessage, ChatOutgoingMessage, ChatSession, PromptProgress } from "./chatSession";
import type { ConversationMessage } from "./prompt";

export class ChatPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly session: ChatSession;

  constructor(
    context: vscode.ExtensionContext,
    onPrompt: (
      prompt: string,
      history: ConversationMessage[],
      progress: (event: PromptProgress) => void,
      signal?: AbortSignal,
    ) => Promise<ChatAnswer | string>,
    onDispose: () => void,
  ) {
    this.session = new ChatSession(onPrompt);
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
        const enableThinking = vscode.workspace.getConfiguration("hackl").get<boolean>("enableThinking", false);
        await this.panel.webview.postMessage({ type: "state", enableThinking });
      }
      await this.session.handle(message, (response) => post(this.panel.webview, response));
    });
    this.panel.onDidDispose(onDispose);
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside);
  }
}

async function post(webview: vscode.Webview, message: ChatOutgoingMessage): Promise<boolean> {
  return webview.postMessage(message);
}
