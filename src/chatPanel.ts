import * as vscode from "vscode";
import type { ConversationMessage } from "./prompt";

export class ChatPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly history: ConversationMessage[] = [];

  constructor(context: vscode.ExtensionContext, onPrompt: (prompt: string, history: ConversationMessage[]) => Promise<string>) {
    this.panel = vscode.window.createWebviewPanel(
      "hackl.chat",
      "Hackl",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    this.panel.webview.html = renderHtml(this.panel.webview, context.extensionUri);
    this.panel.webview.onDidReceiveMessage(async (message: { type: string; prompt?: string }) => {
      if (message.type === "clear") {
        this.history.length = 0;
        await this.post("cleared", "");
        return;
      }
      if (message.type !== "prompt" || !message.prompt?.trim()) {
        return;
      }
      await this.post("status", "Thinking...");
      const prompt = message.prompt.trim();
      const previousHistory = [...this.history];
      this.history.push({ role: "user", content: prompt });
      try {
        const answer = await onPrompt(prompt, previousHistory);
        this.history.push({ role: "assistant", content: answer });
        await this.post("answer", answer);
      } catch (error) {
        this.history.pop();
        const text = error instanceof Error ? error.message : String(error);
        await this.post("error", text);
      }
    });
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  private async post(type: string, text: string): Promise<void> {
    await this.panel.webview.postMessage({ type, text });
  }
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const cspSource = webview.cspSource;
  void extensionUri;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hackl</title>
  <style>
    body { font-family: var(--vscode-font-family); margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--vscode-panel-border); }
    h1 { font-size: 13px; font-weight: 600; margin: 0; }
    #thread { padding: 12px 14px 4px; overflow: auto; }
    form { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 10px 14px 14px; border-top: 1px solid var(--vscode-panel-border); }
    textarea { min-height: 72px; max-height: 220px; resize: vertical; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; font-family: var(--vscode-font-family); }
    button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 0 14px; cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); padding: 4px 10px; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.6; cursor: default; }
    .entry { border-top: 1px solid var(--vscode-panel-border); padding: 12px 0; white-space: pre-wrap; }
    .entry:first-child { border-top: 0; }
    .role { display: block; font-weight: 600; margin-bottom: 6px; }
    .status { color: var(--vscode-descriptionForeground); }
    .error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <h1>Hackl</h1>
      <button id="clear" class="secondary" type="button">Clear</button>
    </header>
    <main id="thread"></main>
    <form id="form">
      <textarea id="prompt" placeholder="Ask Hackl about the current editor context"></textarea>
      <button id="send" type="submit">Send</button>
    </form>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById("form");
    const prompt = document.getElementById("prompt");
    const thread = document.getElementById("thread");
    const send = document.getElementById("send");
    const clear = document.getElementById("clear");
    let statusEntry;

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = prompt.value.trim();
      if (!text) return;
      append("entry", "You", text);
      prompt.value = "";
      setBusy(true);
      vscode.postMessage({ type: "prompt", prompt: text });
    });

    prompt.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    clear.addEventListener("click", () => {
      thread.textContent = "";
      vscode.postMessage({ type: "clear" });
    });

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message.type === "status") showStatus(message.text);
      if (message.type === "answer") {
        clearStatus();
        setBusy(false);
        append("entry", "Hackl", message.text);
      }
      if (message.type === "error") {
        clearStatus();
        setBusy(false);
        append("entry error", "Error", message.text);
      }
    });

    function append(className, role, text) {
      const element = document.createElement("section");
      element.className = className;
      const label = document.createElement("span");
      label.className = "role";
      label.textContent = role;
      element.appendChild(label);
      element.appendChild(document.createTextNode(text));
      thread.appendChild(element);
      element.scrollIntoView();
    }

    function showStatus(text) {
      clearStatus();
      statusEntry = document.createElement("section");
      statusEntry.className = "entry status";
      statusEntry.textContent = text;
      thread.appendChild(statusEntry);
      statusEntry.scrollIntoView();
    }

    function clearStatus() {
      if (statusEntry) {
        statusEntry.remove();
        statusEntry = undefined;
      }
    }

    function setBusy(busy) {
      send.disabled = busy;
      prompt.disabled = busy;
      clear.disabled = busy;
    }
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
