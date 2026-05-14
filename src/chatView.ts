import * as vscode from "vscode";
import { renderChatHtml } from "./chatHtml";
import { ApprovalRequester, ChatAnswer, ChatIncomingMessage, ChatOutgoingMessage, ChatSession, ChatState, PromptProgress } from "./chatSession";
import type { ConversationMessage, PromptMode } from "./prompt";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "hackl.chatView";
  private readonly session: ChatSession;
  private view: vscode.WebviewView | undefined;
  private pendingFocus = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    onPrompt: (
      prompt: string,
      history: ConversationMessage[],
      mode: PromptMode,
      progress: (event: PromptProgress) => void,
      requestApproval: ApprovalRequester,
      signal?: AbortSignal,
    ) => Promise<ChatAnswer | string>,
    private readonly getState: () => Promise<ChatState>,
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
    if (this.pendingFocus) {
      this.pendingFocus = false;
      void post(webviewView.webview, { type: "focusInput" });
    }
    webviewView.webview.onDidReceiveMessage(async (message: ChatIncomingMessage) => {
      if (message.type === "setThinking") {
        await vscode.workspace.getConfiguration("hackl").update("enableThinking", Boolean(message.value), vscode.ConfigurationTarget.Global);
        return;
      }
      if (message.type === "ready") {
        await webviewView.webview.postMessage(await this.getState());
      }
      await this.session.handle(message, (response) => post(webviewView.webview, response));
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

  focusInput(): void {
    if (this.view) {
      void post(this.view.webview, { type: "focusInput" });
    } else {
      this.pendingFocus = true;
    }
  }
}

async function post(webview: vscode.Webview, message: ChatOutgoingMessage): Promise<boolean> {
  return webview.postMessage(message);
}
