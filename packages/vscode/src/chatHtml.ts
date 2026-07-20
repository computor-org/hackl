import * as vscode from "vscode";
import { randomBytes } from "node:crypto";

interface ChatAssets {
  markdownItScript: vscode.Uri;
  katexScript: vscode.Uri;
  katexStyle: vscode.Uri;
  codiconStyle: vscode.Uri;
  chatScript: vscode.Uri;
  chatStyle: vscode.Uri;
}

export function renderChatHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const assets = getChatAssets(webview, extensionUri);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hackl</title>
  <link rel="stylesheet" href="${assets.codiconStyle}">
  <link rel="stylesheet" href="${assets.katexStyle}">
  <link rel="stylesheet" href="${assets.chatStyle}">
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <h1>Hackl</h1>
        <span class="subtitle">local</span>
      </div>
      <div id="endpoint-status" class="endpoint-status" title="" aria-label="Endpoint status"></div>
      <button id="clear" class="icon-button" type="button" title="Clear transcript" aria-label="Clear transcript"><span class="codicon codicon-clear-all" aria-hidden="true"></span></button>
    </header>
    <main id="thread" aria-live="polite">
      <div id="empty-state" class="empty-state">
        <div class="empty-mark" aria-hidden="true"></div>
        <div class="empty-title">Hi. How can I help?</div>
        <div class="empty-hint">Ask about the open file, paste code, or describe what you want to build.</div>
        <div class="empty-chips">
          <button class="chip" type="button" data-suggest="Explain what this file does and how it fits into the project.">Explain this file</button>
          <button class="chip" type="button" data-suggest="Find potential bugs or risky patterns in the current selection.">Find bugs in selection</button>
          <button class="chip" type="button" data-suggest="Suggest a clean refactor for the selected code.">Refactor selection</button>
        </div>
      </div>
    </main>
    <section id="basket" class="basket" hidden>
      <header class="basket-header">
        <span class="basket-title">Context</span>
        <span id="basket-count" class="basket-count"></span>
        <button id="basket-add" class="basket-action" type="button" title="Attach context" aria-label="Attach context">
          <span class="codicon codicon-add" aria-hidden="true"></span>
        </button>
        <button id="basket-clear" class="basket-action" type="button" title="Clear context" aria-label="Clear context">
          <span class="codicon codicon-clear-all" aria-hidden="true"></span>
        </button>
      </header>
      <ul id="basket-list" class="basket-list"></ul>
    </section>
    <form id="form">
      <div class="compose">
        <textarea id="prompt" placeholder="Message Hackl" rows="1"></textarea>
        <div class="compose-toolbar">
          <button id="attach" class="tool-button" type="button" title="Attach context" aria-label="Attach context">
            <span class="codicon codicon-add" aria-hidden="true"></span>
          </button>
          <button id="annotations-discard" class="tool-button" type="button" title="Discard the last batch of AI annotations (Ctrl+Alt+Z)" aria-label="Discard last annotations" hidden>
            <span class="codicon codicon-discard" aria-hidden="true"></span>
          </button>
          <div class="mode-dropdown">
            <button id="mode-button" class="mode-button" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Mode">
              <span id="mode-label">Ask</span>
              <span class="codicon codicon-chevron-down" aria-hidden="true"></span>
            </button>
            <div id="mode-menu" class="mode-menu" role="listbox" hidden>
              <button class="mode-option" type="button" role="option" data-value="ask" aria-selected="true" title="Read-only. Answer questions. No file edits, no commands.">Ask</button>
              <button class="mode-option" type="button" role="option" data-value="edit" aria-selected="false" title="Read + edit files. No search, no commands.">Edit</button>
              <button class="mode-option" type="button" role="option" data-value="work" aria-selected="false" title="Read + edit + search. Multi-step file changes. No commands.">Work</button>
              <button class="mode-option" type="button" role="option" data-value="agent" aria-selected="false" title="Read + edit + search + safe commands (approval-gated).">Agent</button>
              <button class="mode-option mode-option-danger" type="button" role="option" data-value="yolo" aria-selected="false" title="DANGER: no command policy, no approval. Runs ANY shell command. You are responsible for what happens.">Yolo</button>
            </div>
          </div>
          <div class="mode-dropdown model-dropdown">
            <button id="model-button" class="mode-button" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Model" title="Pick backend and model">
              <span id="model-label">Local</span>
              <span class="codicon codicon-chevron-down" aria-hidden="true"></span>
            </button>
            <div id="model-menu" class="mode-menu" role="listbox" hidden></div>
          </div>
          <button id="reasoning-toggle" class="tool-button" type="button" title="Toggle reasoning" aria-label="Toggle reasoning" aria-pressed="false">
            <span class="codicon codicon-lightbulb" aria-hidden="true"></span>
          </button>
          <div class="compose-spacer"></div>
          <span id="context-meter" class="meter" title="Estimated prompt tokens / configured context window"></span>
          <button id="send" class="send-button" type="submit" title="Send (Enter)" aria-label="Send"><span class="codicon codicon-arrow-up" aria-hidden="true"></span></button>
        </div>
      </div>
    </form>
  </div>
  <script nonce="${nonce}" src="${assets.markdownItScript}"></script>
  <script nonce="${nonce}" src="${assets.katexScript}"></script>
  <script nonce="${nonce}" src="${assets.chatScript}"></script>
</body>
</html>`;
}

function getChatAssets(webview: vscode.Webview, extensionUri: vscode.Uri): ChatAssets {
  return {
    markdownItScript: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "vendor", "markdown-it", "markdown-it.min.js")),
    katexScript: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "vendor", "katex", "katex.min.js")),
    katexStyle: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "vendor", "katex", "katex.min.css")),
    codiconStyle: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "vendor", "codicons", "codicon.css")),
    chatScript: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "chat", "main.js")),
    chatStyle: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "chat", "main.css")),
  };
}

function getNonce(): string {
  return randomBytes(16).toString("hex");
}
