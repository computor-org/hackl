import * as vscode from "vscode";
import { renderChatHtml } from "./chatHtml";
import { ChatAnswer, ChatIncomingMessage, ChatOutgoingMessage, ChatSession, PromptProgress } from "./chatSession";
import type { ConversationMessage } from "./prompt";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "hackl.chatView";
  private readonly session: ChatSession;
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    onPrompt: (
      prompt: string,
      history: ConversationMessage[],
      progress: (event: PromptProgress) => void,
    ) => Promise<ChatAnswer | string>,
  ) {
    this.session = new ChatSession(onPrompt);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.title = "Chat";
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.html = renderChatHtml(webviewView.webview, this.context.extensionUri);
    webviewView.webview.onDidReceiveMessage((message: ChatIncomingMessage) => {
      void this.session.handle(message, (response) => post(webviewView.webview, response));
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
  }

  show(): void {
    this.view?.show(false);
  }
}

async function post(webview: vscode.Webview, message: ChatOutgoingMessage): Promise<boolean> {
  return webview.postMessage(message);
}
