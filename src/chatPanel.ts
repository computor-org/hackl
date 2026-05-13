import * as vscode from "vscode";

export class ChatPanel {
  private readonly panel: vscode.WebviewPanel;

  constructor(context: vscode.ExtensionContext, onPrompt: (prompt: string) => Promise<string>) {
    this.panel = vscode.window.createWebviewPanel(
      "hackl.chat",
      "Hackl",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    this.panel.webview.html = renderHtml(this.panel.webview, context.extensionUri);
    this.panel.webview.onDidReceiveMessage(async (message: { type: string; prompt?: string }) => {
      if (message.type !== "prompt" || !message.prompt?.trim()) {
        return;
      }
      await this.post("status", "Thinking...");
      try {
        const answer = await onPrompt(message.prompt.trim());
        await this.post("answer", answer);
      } catch (error) {
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
    body { font-family: var(--vscode-font-family); margin: 0; padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    form { display: flex; gap: 8px; margin-bottom: 16px; }
    textarea { flex: 1; min-height: 80px; resize: vertical; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; }
    button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 0 14px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .entry { border-top: 1px solid var(--vscode-panel-border); padding: 12px 0; white-space: pre-wrap; }
    .status { color: var(--vscode-descriptionForeground); }
    .error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <form id="form">
    <textarea id="prompt" placeholder="Ask Hackl about the current editor context"></textarea>
    <button type="submit">Send</button>
  </form>
  <main id="thread"></main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById("form");
    const prompt = document.getElementById("prompt");
    const thread = document.getElementById("thread");

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = prompt.value.trim();
      if (!text) return;
      append("entry", "You:\\n" + text);
      prompt.value = "";
      vscode.postMessage({ type: "prompt", prompt: text });
    });

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message.type === "status") append("entry status", message.text);
      if (message.type === "answer") append("entry", "Hackl:\\n" + message.text);
      if (message.type === "error") append("entry error", "Error:\\n" + message.text);
    });

    function append(className, text) {
      const element = document.createElement("section");
      element.className = className;
      element.textContent = text;
      thread.appendChild(element);
      element.scrollIntoView();
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
