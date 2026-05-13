import * as vscode from "vscode";

interface ChatAssets {
  markdownItScript: vscode.Uri;
  katexScript: vscode.Uri;
  katexStyle: vscode.Uri;
  codiconStyle: vscode.Uri;
}

export function renderChatHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const assets = getChatAssets(webview, extensionUri);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hackl</title>
  <link rel="stylesheet" href="${assets.codiconStyle}">
  <link rel="stylesheet" href="${assets.katexStyle}">
  <style>${styles}</style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <h1>Hackl</h1>
        <span class="subtitle">local</span>
      </div>
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
    <form id="form">
      <div class="compose">
        <textarea id="prompt" placeholder="Message Hackl" rows="1"></textarea>
        <div class="compose-toolbar">
          <button id="attach" class="tool-button" type="button" disabled title="Attach (coming soon)" aria-label="Attach">
            <span class="codicon codicon-add" aria-hidden="true"></span>
          </button>
          <div class="mode-dropdown">
            <button id="mode-button" class="mode-button" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Mode">
              <span id="mode-label">Ask</span>
              <span class="codicon codicon-chevron-down" aria-hidden="true"></span>
            </button>
            <div id="mode-menu" class="mode-menu" role="listbox" hidden>
              <button class="mode-option" type="button" role="option" data-value="ask" aria-selected="true">Ask</button>
              <button class="mode-option" type="button" role="option" data-value="edit" disabled aria-disabled="true">Edit <span class="mode-option-tag">soon</span></button>
              <button class="mode-option" type="button" role="option" data-value="agent" disabled aria-disabled="true">Agent <span class="mode-option-tag">soon</span></button>
            </div>
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
  <script nonce="${nonce}">${clientScript}</script>
</body>
</html>`;
}

function getChatAssets(webview: vscode.Webview, extensionUri: vscode.Uri): ChatAssets {
  return {
    markdownItScript: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "vendor", "markdown-it", "markdown-it.min.js")),
    katexScript: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "vendor", "katex", "katex.min.js")),
    katexStyle: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "vendor", "katex", "katex.min.css")),
    codiconStyle: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "vendor", "codicons", "codicon.css")),
  };
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

const styles = `
:root {
  color-scheme: light dark;
  --hackl-accent: var(--vscode-textLink-foreground, #4c9aff);
  --hackl-surface: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
  --hackl-surface-strong: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
  --hackl-border: color-mix(in srgb, var(--vscode-foreground) 14%, transparent);
  --hackl-radius: 10px;
  --hackl-radius-sm: 6px;
}

html,
body {
  height: 100%;
}

body {
  margin: 0;
  overflow: hidden;
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  font-family: var(--vscode-font-family);
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.shell {
  height: 100vh;
  min-height: 0;
  display: grid;
  grid-template-rows: auto 1fr auto;
  overflow: hidden;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px;
  border-bottom: 1px solid var(--hackl-border);
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
}

.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.brand-mark {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, var(--hackl-accent), color-mix(in srgb, var(--hackl-accent) 30%, transparent));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--hackl-accent) 18%, transparent);
}

h1 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.1px;
}

.subtitle {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}

.meter {
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  font-size: 10.5px;
  letter-spacing: 0.2px;
  white-space: nowrap;
  opacity: 0.85;
}

.meter:empty {
  display: none;
}

#thread {
  min-height: 0;
  overflow-y: auto;
  scroll-behavior: smooth;
  padding: 12px 10px 8px;
  scrollbar-width: thin;
}

#thread::-webkit-scrollbar {
  width: 8px;
}

#thread::-webkit-scrollbar-thumb {
  background: var(--hackl-surface-strong);
  border-radius: 4px;
}

.entry {
  padding: 0 0 18px;
  animation: hackl-fade 160ms ease-out both;
}

.entry:last-child {
  padding-bottom: 4px;
}

@keyframes hackl-fade {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: none; }
}

.role {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 6px;
  padding: 0 2px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.3px;
  text-transform: lowercase;
}

.role::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vscode-descriptionForeground);
  opacity: 0.55;
}

.assistant .role::before {
  background: var(--hackl-accent);
  opacity: 1;
}

.user .role::before {
  background: color-mix(in srgb, var(--vscode-foreground) 60%, transparent);
}

.error .role::before {
  background: var(--vscode-errorForeground);
}

.body {
  font-size: 13px;
  line-height: 1.55;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}

.user .body {
  display: inline-block;
  max-width: 100%;
  padding: 8px 12px;
  border-radius: var(--hackl-radius);
  border-bottom-left-radius: 3px;
  background: var(--hackl-surface);
  white-space: pre-wrap;
}

.user.queued .body {
  border: 1px dashed color-mix(in srgb, var(--hackl-accent) 60%, var(--hackl-border));
  background: transparent;
}

.user.queued .role::after {
  content: "queued";
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--hackl-accent) 18%, transparent);
  color: var(--hackl-accent);
  font-size: 10px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}

.assistant .body {
  padding: 0;
}

.reasoning {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: var(--hackl-radius-sm);
  background: var(--hackl-surface);
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  font-size: 11.5px;
  line-height: 1.45;
}

.reasoning[hidden] {
  display: none;
}

.reasoning-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: auto;
  height: auto;
  min-width: 0;
  margin: 0 0 4px;
  padding: 0;
  color: var(--vscode-descriptionForeground);
  background: transparent;
  font-family: var(--vscode-editor-font-family);
  font-size: 10.5px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  cursor: pointer;
}

.reasoning-toggle:hover {
  color: var(--vscode-foreground);
  background: transparent;
}

.reasoning-toggle .codicon {
  transition: transform 120ms ease;
}

.reasoning-text {
  max-height: 42px;
  overflow: hidden;
  white-space: pre-wrap;
  opacity: 0.85;
}

.reasoning.expanded .reasoning-text {
  max-height: none;
  opacity: 1;
}

.reasoning.expanded .codicon-chevron-right {
  transform: rotate(90deg);
}

.body :first-child {
  margin-top: 0;
}

.body :last-child {
  margin-bottom: 0;
}

.body p {
  margin: 0 0 10px;
}

.body h1,
.body h2,
.body h3,
.body h4 {
  margin: 14px 0 6px;
  font-weight: 600;
  line-height: 1.3;
}

.body h1 { font-size: 16px; }
.body h2 { font-size: 14.5px; }
.body h3 { font-size: 13.5px; }

.body ul,
.body ol {
  margin: 0 0 10px;
  padding-left: 22px;
}

.body li { margin: 2px 0; }

.body hr {
  border: 0;
  border-top: 1px solid var(--hackl-border);
  margin: 14px 0;
}

.body pre {
  overflow: auto;
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: var(--hackl-radius-sm);
  border: 1px solid var(--hackl-border);
  background: var(--vscode-textCodeBlock-background, var(--hackl-surface));
  font-size: 12px;
  line-height: 1.5;
}

.body code {
  font-family: var(--vscode-editor-font-family);
  font-size: 12px;
}

.body p code,
.body li code,
.body td code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--hackl-surface);
  font-size: 12px;
}

.body blockquote {
  margin: 8px 0;
  padding: 2px 0 2px 12px;
  color: var(--vscode-descriptionForeground);
  border-left: 2px solid color-mix(in srgb, var(--hackl-accent) 60%, transparent);
}

.body a {
  color: var(--vscode-textLink-foreground);
  text-decoration: none;
}

.body a:hover { text-decoration: underline; }

.body table {
  border-collapse: collapse;
  font-size: 12.5px;
  margin: 6px 0;
}

.body th,
.body td {
  padding: 4px 8px;
  border: 1px solid var(--hackl-border);
}

.status {
  padding: 0 0 14px;
}

.status .body {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--hackl-surface);
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  font-size: 11.5px;
}

.status .body::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--hackl-accent);
  animation: hackl-pulse 1.1s ease-in-out infinite;
}

@keyframes hackl-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.1); }
}

.error .body {
  padding: 8px 12px;
  border-radius: var(--hackl-radius-sm);
  background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent);
  color: var(--vscode-errorForeground);
  border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 30%, transparent);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 16px 18px;
  gap: 10px;
  color: var(--vscode-descriptionForeground);
}

.empty-state.hidden { display: none; }

.empty-mark {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, var(--hackl-accent), color-mix(in srgb, var(--hackl-accent) 30%, transparent));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--hackl-accent) 14%, transparent);
  margin-bottom: 4px;
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.empty-hint {
  font-size: 12px;
  max-width: 240px;
  line-height: 1.45;
}

.empty-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-top: 6px;
}

.chip {
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--hackl-border);
  background: transparent;
  color: var(--vscode-foreground);
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.chip:hover {
  background: var(--hackl-surface);
  border-color: color-mix(in srgb, var(--hackl-accent) 50%, var(--hackl-border));
}

form {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px 10px;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
}

.compose {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px 6px;
  border-radius: 14px;
  border: 1px solid var(--hackl-border);
  background: var(--vscode-input-background);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.compose:focus-within {
  border-color: color-mix(in srgb, var(--hackl-accent) 70%, var(--hackl-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--hackl-accent) 18%, transparent);
}

textarea {
  width: 100%;
  min-height: 22px;
  max-height: 200px;
  resize: none;
  color: var(--vscode-input-foreground);
  background: transparent;
  border: 0;
  padding: 2px 0;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  outline: none;
}

textarea::placeholder {
  color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
  opacity: 0.8;
}

.compose-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
}

.tool-button {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--vscode-descriptionForeground);
  background: transparent;
  cursor: pointer;
  transition: background 100ms ease, color 100ms ease, opacity 100ms ease, transform 80ms ease;
}

.tool-button .codicon {
  font-size: 13px;
  transition: transform 80ms ease;
}

.tool-button:not(:disabled):hover {
  background: var(--hackl-surface-strong);
  color: var(--vscode-foreground);
}

.tool-button:not(:disabled):active {
  transform: scale(0.92);
}

.tool-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.tool-button[aria-pressed="true"] {
  color: var(--vscode-button-foreground, #fff);
  background: var(--hackl-accent);
}

.tool-button[aria-pressed="true"]:not(:disabled):hover {
  background: color-mix(in srgb, var(--hackl-accent) 85%, white);
  color: var(--vscode-button-foreground, #fff);
}

.mode-dropdown {
  position: relative;
  display: inline-flex;
}

.mode-button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px 2px 8px;
  height: 22px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  font: inherit;
  font-size: 11.5px;
  letter-spacing: 0.2px;
  cursor: pointer;
  transition: background 100ms ease, color 100ms ease;
}

.mode-button .codicon {
  font-size: 11px;
  opacity: 0.8;
}

.mode-button:hover,
.mode-button[aria-expanded="true"] {
  background: var(--hackl-surface-strong);
  color: var(--vscode-foreground);
}

.mode-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 10;
  min-width: 140px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--hackl-border);
  background: var(--vscode-menu-background, var(--vscode-editor-background));
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.mode-menu[hidden] {
  display: none;
}

.mode-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--vscode-foreground);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.mode-option:not(:disabled):hover {
  background: var(--hackl-surface-strong);
}

.mode-option[aria-selected="true"] {
  color: var(--hackl-accent);
}

.mode-option:disabled {
  color: var(--vscode-descriptionForeground);
  opacity: 0.55;
  cursor: default;
}

.mode-option-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--hackl-surface);
  color: var(--vscode-descriptionForeground);
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

.compose-spacer {
  flex: 1;
}


button {
  cursor: pointer;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: 0;
  font-family: inherit;
}

button:hover {
  background: var(--vscode-button-hoverBackground);
}

button:disabled {
  opacity: 0.55;
  cursor: default;
}

.icon-button {
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--vscode-icon-foreground);
  background: transparent;
}

.icon-button:hover {
  background: var(--hackl-surface);
}

.send-button {
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--hackl-accent);
  color: var(--vscode-button-foreground, #fff);
  transition: transform 80ms ease, background 120ms ease, opacity 120ms ease;
}

.send-button:not(:disabled):hover {
  background: color-mix(in srgb, var(--hackl-accent) 85%, white);
}

.send-button:not(:disabled):active {
  transform: scale(0.92);
}

.send-button:disabled {
  background: var(--hackl-surface-strong);
  color: var(--vscode-descriptionForeground);
  opacity: 0.6;
  cursor: default;
}

.send-button .codicon {
  font-size: 13px;
}

.send-button.stop {
  background: color-mix(in srgb, var(--vscode-errorForeground) 65%, var(--vscode-descriptionForeground) 35%);
  color: var(--vscode-button-foreground, #fff);
  opacity: 1;
  cursor: pointer;
}

.send-button.stop:hover {
  background: color-mix(in srgb, var(--vscode-errorForeground) 85%, var(--vscode-foreground) 15%);
}

.send-button.stop .codicon {
  font-size: 11px;
}

.queued-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 6px;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease;
  cursor: pointer;
  vertical-align: middle;
}

.queued-remove .codicon {
  font-size: 11px;
}

.user.queued:hover .queued-remove {
  opacity: 1;
}

.queued-remove:hover {
  background: var(--hackl-surface-strong);
  color: var(--vscode-foreground);
}

.katex-display {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 2px 0;
}
`;

const clientScript = `
(function () {
  const vscode = acquireVsCodeApi();
  const form = document.getElementById("form");
  const prompt = document.getElementById("prompt");
  const thread = document.getElementById("thread");
  const send = document.getElementById("send");
  const clear = document.getElementById("clear");
  const contextMeter = document.getElementById("context-meter");
  const emptyState = document.getElementById("empty-state");
  const reasoningToggle = document.getElementById("reasoning-toggle");
  const modeButton = document.getElementById("mode-button");
  const modeMenu = document.getElementById("mode-menu");
  const modeLabel = document.getElementById("mode-label");
  const md = window.markdownit({ html: false, linkify: true, breaks: false });
  let statusEntry;
  let assistantDraft;
  let isBusy = false;
  const pendingQueue = [];

  installMath(md);
  autoResize();
  updateEmptyState();
  vscode.postMessage({ type: "ready" });
  focusPrompt();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = prompt.value.trim();
    if (!text) return;
    const entry = appendUser(text);
    prompt.value = "";
    autoResize();
    focusPrompt();
    if (isBusy) {
      const item = { text, entry };
      pendingQueue.push(item);
      markQueued(entry, true, () => removeQueuedItem(item));
      updateSendState();
      return;
    }
    sendPrompt(text);
  });

  send.addEventListener("click", (event) => {
    if (!isBusy) return;
    event.preventDefault();
    stopRun();
  });

  prompt.addEventListener("input", () => {
    autoResize();
    updateSendState();
  });

  prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (isBusy) return;
      form.requestSubmit();
      return;
    }
    if (event.key === "Escape" && isBusy) {
      event.preventDefault();
      stopRun();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isBusy && event.target !== prompt) {
      event.preventDefault();
      stopRun();
    }
  });

  clear.addEventListener("click", () => {
    vscode.postMessage({ type: "clear" });
  });

  if (reasoningToggle) {
    reasoningToggle.addEventListener("click", () => {
      const next = reasoningToggle.getAttribute("aria-pressed") !== "true";
      reasoningToggle.setAttribute("aria-pressed", String(next));
      vscode.postMessage({ type: "setThinking", value: next });
      focusPrompt();
    });
  }

  if (modeButton && modeMenu) {
    modeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = modeMenu.hidden;
      modeMenu.hidden = !open;
      modeButton.setAttribute("aria-expanded", String(open));
    });
    modeMenu.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const option = target.closest(".mode-option");
      if (!option || option.hasAttribute("disabled")) return;
      const value = option.getAttribute("data-value") || "ask";
      if (modeLabel) modeLabel.textContent = option.firstChild ? (option.firstChild.textContent || "").trim() : value;
      modeMenu.querySelectorAll(".mode-option").forEach((opt) => {
        opt.setAttribute("aria-selected", String(opt === option));
      });
      modeMenu.hidden = true;
      modeButton.setAttribute("aria-expanded", "false");
      focusPrompt();
    });
    document.addEventListener("click", (event) => {
      if (modeMenu.hidden) return;
      const target = event.target;
      if (target instanceof Node && (modeButton.contains(target) || modeMenu.contains(target))) return;
      modeMenu.hidden = true;
      modeButton.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modeMenu.hidden) {
        event.preventDefault();
        modeMenu.hidden = true;
        modeButton.setAttribute("aria-expanded", "false");
        focusPrompt();
      }
    });
  }

  if (emptyState) {
    emptyState.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const chip = target.closest(".chip");
      if (!chip) return;
      const suggestion = chip.getAttribute("data-suggest") || chip.textContent || "";
      prompt.value = suggestion;
      autoResize();
      prompt.focus();
    });
  }

  function autoResize() {
    prompt.style.height = "auto";
    const next = Math.min(prompt.scrollHeight, 200);
    prompt.style.height = next + "px";
  }

  function updateEmptyState() {
    if (!emptyState) return;
    const hasEntries = thread.querySelector(".entry");
    emptyState.classList.toggle("hidden", Boolean(hasEntries));
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "history") renderHistory(message.entries || []);
    if (message.type === "cleared") clearThread();
    if (message.type === "status") showStatus(message.text);
    if (message.type === "metrics") updateMeter(message.inputTokens, message.maxContextTokens);
    if (message.type === "state") applyState(message);
    if (message.type === "assistantDelta") appendAssistantDelta(message.channel, message.text);
    if (message.type === "answer") {
      clearStatus();
      finishAssistant(message.text, message.reasoning || "");
      setBusy(false);
      drainQueue();
    }
    if (message.type === "error") {
      clearStatus();
      appendError(message.text);
      setBusy(false);
      drainQueue();
    }
  });

  function sendPrompt(text) {
    setBusy(true);
    vscode.postMessage({ type: "prompt", prompt: text });
  }

  function drainQueue() {
    if (isBusy) return;
    const next = pendingQueue.shift();
    if (!next) {
      focusPrompt();
      return;
    }
    markQueued(next.entry, false);
    sendPrompt(next.text);
  }

  function markQueued(entry, queued, onRemove) {
    if (!entry) return;
    entry.classList.toggle("queued", queued);
    const existing = entry.querySelector(".queued-remove");
    if (queued && !existing && typeof onRemove === "function") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "queued-remove";
      button.title = "Remove from queue";
      button.setAttribute("aria-label", "Remove from queue");
      const icon = document.createElement("span");
      icon.className = "codicon codicon-close";
      icon.setAttribute("aria-hidden", "true");
      button.appendChild(icon);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onRemove();
      });
      const label = entry.querySelector(".role");
      if (label) label.appendChild(button);
    }
    if (!queued && existing) {
      existing.remove();
    }
  }

  function removeQueuedItem(item) {
    const index = pendingQueue.indexOf(item);
    if (index >= 0) pendingQueue.splice(index, 1);
    if (item.entry) item.entry.remove();
    updateEmptyState();
  }

  function stopRun() {
    if (!isBusy) return;
    vscode.postMessage({ type: "cancel" });
    for (const item of pendingQueue.splice(0)) {
      if (item.entry) item.entry.remove();
    }
    if (assistantDraft) {
      assistantDraft.element.remove();
      assistantDraft = undefined;
    }
    clearStatus();
    setBusy(false);
    updateEmptyState();
    focusPrompt();
  }

  function focusPrompt() {
    requestAnimationFrame(() => prompt.focus());
  }

  function applyState(message) {
    if (reasoningToggle && typeof message.enableThinking === "boolean") {
      reasoningToggle.setAttribute("aria-pressed", String(message.enableThinking));
    }
  }

  function updateSendState() {
    if (isBusy) {
      send.disabled = false;
      send.classList.add("stop");
      send.title = "Stop (Esc)";
      send.setAttribute("aria-label", "Stop");
      setSendIcon("debug-stop");
      return;
    }
    send.classList.remove("stop");
    setSendIcon("arrow-up");
    send.title = "Send (Enter)";
    send.setAttribute("aria-label", "Send");
    const hasText = prompt.value.trim().length > 0;
    send.disabled = !hasText;
  }

  function setSendIcon(name) {
    const icon = send.querySelector(".codicon");
    if (!icon) return;
    icon.className = "codicon codicon-" + name;
  }

  function renderHistory(entries) {
    clearThread();
    for (const entry of entries) {
      if (entry.role === "user") appendUser(entry.content);
      if (entry.role === "assistant") appendAssistant(entry.content);
    }
  }

  function appendUser(text) {
    return append("entry user", "You", text, false);
  }

  function appendAssistant(text) {
    const split = splitReasoning(text || "");
    appendAssistantEntry(split.answer, split.reasoning);
  }

  function appendError(text) {
    append("entry error", "Error", text, false);
  }

  function append(className, role, text, markdown) {
    const element = document.createElement("section");
    const label = document.createElement("div");
    const body = document.createElement("div");
    element.className = className;
    label.className = "role";
    label.textContent = role;
    body.className = "body";
    if (markdown) {
      body.innerHTML = md.render(text || "");
    } else {
      body.textContent = text || "";
    }
    element.appendChild(label);
    element.appendChild(body);
    thread.appendChild(element);
    updateEmptyState();
    scrollThreadToBottom();
    return element;
  }

  function appendAssistantEntry(answer, reasoning) {
    const entry = createAssistantEntry();
    renderAssistantEntry(entry, answer, reasoning);
    thread.appendChild(entry.element);
    updateEmptyState();
    scrollThreadToBottom();
    return entry;
  }

  function appendAssistantDelta(channel, text) {
    if (!assistantDraft) {
      assistantDraft = createAssistantEntry();
      thread.appendChild(assistantDraft.element);
      updateEmptyState();
    }
    if (channel === "reasoning") {
      assistantDraft.reasoning += text || "";
    } else {
      assistantDraft.answer += text || "";
    }
    renderAssistantEntry(assistantDraft, assistantDraft.answer, assistantDraft.reasoning);
    scrollThreadToBottom();
  }

  function finishAssistant(answer, reasoning) {
    if (!assistantDraft) {
      appendAssistantEntry(answer || "", reasoning || "");
      return;
    }
    renderAssistantEntry(assistantDraft, answer || assistantDraft.answer, reasoning || assistantDraft.reasoning);
    scrollThreadToBottom();
    assistantDraft = undefined;
  }

  function createAssistantEntry() {
    const element = document.createElement("section");
    const label = document.createElement("div");
    const reasoning = document.createElement("div");
    const reasoningToggle = document.createElement("button");
    const reasoningIcon = document.createElement("span");
    const reasoningLabel = document.createElement("span");
    const reasoningText = document.createElement("div");
    const body = document.createElement("div");
    element.className = "entry assistant";
    label.className = "role";
    label.textContent = "Hackl";
    reasoning.className = "reasoning";
    reasoningToggle.className = "reasoning-toggle";
    reasoningToggle.type = "button";
    reasoningToggle.title = "Expand reasoning";
    reasoningIcon.className = "codicon codicon-chevron-right";
    reasoningLabel.textContent = "reasoning";
    reasoningText.className = "reasoning-text";
    reasoningToggle.appendChild(reasoningIcon);
    reasoningToggle.appendChild(reasoningLabel);
    reasoning.appendChild(reasoningToggle);
    reasoning.appendChild(reasoningText);
    reasoningToggle.addEventListener("click", () => {
      const expanded = reasoning.classList.toggle("expanded");
      reasoningToggle.title = expanded ? "Collapse reasoning" : "Expand reasoning";
    });
    body.className = "body";
    element.appendChild(label);
    element.appendChild(reasoning);
    element.appendChild(body);
    return { element, reasoningElement: reasoning, reasoningText, body, reasoning: "", answer: "" };
  }

  function renderAssistantEntry(entry, answer, reasoning) {
    entry.reasoning = reasoning || "";
    entry.answer = answer || "";
    entry.reasoningText.textContent = entry.reasoning;
    entry.reasoningElement.hidden = !entry.reasoning;
    entry.body.innerHTML = md.render(entry.answer || "");
  }

  function splitReasoning(text) {
    let answer = "";
    const reasoning = [];
    let position = 0;
    while (position < text.length) {
      const start = text.indexOf("<think>", position);
      if (start < 0) {
        answer += text.slice(position);
        break;
      }
      answer += text.slice(position, start);
      const bodyStart = start + "<think>".length;
      const end = text.indexOf("</think>", bodyStart);
      if (end < 0) {
        reasoning.push(text.slice(bodyStart));
        break;
      }
      reasoning.push(text.slice(bodyStart, end));
      position = end + "</think>".length;
    }
    return { answer: answer.trimStart(), reasoning: reasoning.join("\\n\\n").trim() };
  }

  function showStatus(text) {
    clearStatus();
    statusEntry = document.createElement("section");
    statusEntry.className = "entry status";
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = text;
    statusEntry.appendChild(body);
    thread.appendChild(statusEntry);
    scrollThreadToBottom();
  }

  function clearStatus() {
    if (statusEntry) {
      statusEntry.remove();
      statusEntry = undefined;
    }
  }

  function clearThread() {
    const entries = thread.querySelectorAll(".entry");
    entries.forEach((node) => node.remove());
    assistantDraft = undefined;
    pendingQueue.length = 0;
    clearStatus();
    setBusy(false);
    updateEmptyState();
    focusPrompt();
  }

  function updateMeter(inputTokens, maxContextTokens) {
    if (!contextMeter || !inputTokens || !maxContextTokens) return;
    const percent = Math.round((inputTokens / maxContextTokens) * 100);
    contextMeter.textContent = compactTokens(inputTokens) + " / " + compactTokens(maxContextTokens);
    contextMeter.title = "~" + inputTokens.toLocaleString() + " of " + maxContextTokens.toLocaleString() + " tokens (" + percent + "%)";
  }

  function compactTokens(n) {
    if (n >= 1000) {
      const k = n / 1000;
      return (k >= 10 ? Math.round(k) : Math.round(k * 10) / 10) + "k";
    }
    return String(n);
  }

  function scrollThreadToBottom() {
    requestAnimationFrame(() => {
      thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
    });
  }

  function setBusy(busy) {
    isBusy = busy;
    clear.disabled = busy;
    updateSendState();
  }

  function installMath(markdown) {
    markdown.inline.ruler.before("escape", "math_inline", mathInline);
    markdown.block.ruler.before("fence", "math_block", mathBlock, { alt: ["paragraph", "reference", "blockquote"] });
    markdown.renderer.rules.math_inline = (tokens, idx) => renderMath(tokens[idx].content, false);
    markdown.renderer.rules.math_block = (tokens, idx) => renderMath(tokens[idx].content, true);
  }

  function mathInline(state, silent) {
    if (state.src.charCodeAt(state.pos) !== 0x24) return false;
    const start = state.pos + 1;
    const end = state.src.indexOf("$", start);
    if (end < 0 || end === start) return false;
    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = state.src.slice(start, end);
    }
    state.pos = end + 1;
    return true;
  }

  function mathBlock(state, startLine, endLine, silent) {
    let position = state.bMarks[startLine] + state.tShift[startLine];
    let maximum = state.eMarks[startLine];
    if (state.src.slice(position, position + 2) !== "$$") return false;
    let firstLine = state.src.slice(position + 2, maximum);
    if (firstLine.trim().endsWith("$$")) {
      firstLine = firstLine.trim().slice(0, -2);
      return pushMathBlock(state, startLine, startLine + 1, firstLine, silent);
    }
    const lines = [firstLine];
    for (let nextLine = startLine + 1; nextLine < endLine; nextLine++) {
      position = state.bMarks[nextLine] + state.tShift[nextLine];
      maximum = state.eMarks[nextLine];
      const line = state.src.slice(position, maximum);
      if (line.trim() === "$$") {
        return pushMathBlock(state, startLine, nextLine + 1, lines.join("\\n"), silent);
      }
      lines.push(line);
    }
    return false;
  }

  function pushMathBlock(state, startLine, nextLine, content, silent) {
    if (!silent) {
      const token = state.push("math_block", "math", 0);
      token.block = true;
      token.content = content.trim();
      token.map = [startLine, nextLine];
    }
    state.line = nextLine;
    return true;
  }

  function renderMath(source, displayMode) {
    return window.katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false
    });
  }
}());
`;
