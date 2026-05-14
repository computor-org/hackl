import * as vscode from "vscode";
import { renderChatHtml } from "./chatHtml";
import {
  BasketBridge,
  ChatIncomingMessage,
  ChatOutgoingMessage,
  ChatSession,
  ChatState,
  PromptHandler,
  ReviewTargetResolver,
  isAllowedWebviewCommand,
} from "./chatSession";

export { isAllowedWebviewCommand };

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "hackl.chatView";
  private readonly session: ChatSession;
  private view: vscode.WebviewView | undefined;
  private pendingFocus = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    onPrompt: PromptHandler,
    private readonly getState: () => Promise<ChatState>,
    basket?: BasketBridge,
    resolveReviewTargets?: ReviewTargetResolver,
  ) {
    this.session = new ChatSession(onPrompt, basket, resolveReviewTargets);
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
      if (message.type === "runCommand" && typeof message.value === "string" && isAllowedWebviewCommand(message.value)) {
        await vscode.commands.executeCommand(message.value);
        return;
      }
      await this.session.handle(message, (response) => post(webviewView.webview, response));
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
      this.session.dispose();
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

  submitPreset(prompt: string, mode: import("./prompt").PromptMode, options: { createAnnotations?: boolean }): Promise<void> {
    return this.session.runDirect(prompt, mode, options, (response) => {
      if (!this.view) return Promise.resolve(false);
      return post(this.view.webview, response);
    });
  }

  setPromptText(text: string): void {
    if (!this.view) return;
    void post(this.view.webview, { type: "setPromptText", text });
  }

  notifyStatus(text: string): void {
    if (this.view) {
      void post(this.view.webview, { type: "status", text });
      return;
    }
    void (async () => {
      const vsc = (await import("vscode"));
      vsc.window.setStatusBarMessage(`Hackl: ${text}`, 4000);
    })();
  }
}

async function post(webview: vscode.Webview, message: ChatOutgoingMessage): Promise<boolean> {
  return webview.postMessage(message);
}
