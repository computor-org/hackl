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
      <div>
        <h1>Hackl</h1>
        <span class="subtitle">local AI chat</span>
      </div>
      <button id="clear" class="icon-button" type="button" title="Clear transcript" aria-label="Clear transcript"><span class="codicon codicon-clear-all" aria-hidden="true"></span></button>
    </header>
    <main id="thread" aria-live="polite"></main>
    <form id="form">
      <textarea id="prompt" placeholder="Ask Hackl about the current editor context" rows="3"></textarea>
      <button id="send" class="send-button" type="submit" title="Send" aria-label="Send"><span class="codicon codicon-send" aria-hidden="true"></span></button>
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
}

body {
  margin: 0;
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

.shell {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
}

h1 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0;
}

.subtitle {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
}

#thread {
  overflow: auto;
  padding: 6px 10px 2px;
}

.entry {
  padding: 10px 0;
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
}

.entry:last-child {
  border-bottom: 0;
}

.role {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  text-transform: uppercase;
}

.body {
  line-height: 1.45;
}

.body :first-child {
  margin-top: 0;
}

.body :last-child {
  margin-bottom: 0;
}

.body pre {
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--vscode-textBlockQuote-border);
  background: var(--vscode-textCodeBlock-background);
}

.body code {
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
}

.body p code,
.body li code {
  padding: 1px 3px;
  background: var(--vscode-textCodeBlock-background);
}

.body blockquote {
  margin-left: 0;
  padding-left: 10px;
  color: var(--vscode-descriptionForeground);
  border-left: 2px solid var(--vscode-textBlockQuote-border);
}

.body a {
  color: var(--vscode-textLink-foreground);
}

.user .body {
  white-space: pre-wrap;
}

.status .body {
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
}

.error .body {
  color: var(--vscode-errorForeground);
}

form {
  display: grid;
  grid-template-columns: 1fr 32px;
  gap: 6px;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
}

textarea {
  min-height: 66px;
  max-height: 180px;
  resize: vertical;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  padding: 7px;
  font: inherit;
  line-height: 1.35;
}

textarea:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}

button {
  cursor: pointer;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: 0;
}

button:hover {
  background: var(--vscode-button-hoverBackground);
}

button:disabled {
  opacity: 0.65;
  cursor: default;
}

.icon-button,
.send-button {
  width: 28px;
  min-width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 3px;
}

.icon-button {
  color: var(--vscode-icon-foreground);
  background: transparent;
}

.icon-button:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.send-button {
  align-self: end;
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
  const md = window.markdownit({ html: false, linkify: true, breaks: false });
  let statusEntry;

  installMath(md);
  vscode.postMessage({ type: "ready" });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = prompt.value.trim();
    if (!text) return;
    appendUser(text);
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
    vscode.postMessage({ type: "clear" });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "history") renderHistory(message.entries || []);
    if (message.type === "cleared") clearThread();
    if (message.type === "status") showStatus(message.text);
    if (message.type === "answer") {
      clearStatus();
      setBusy(false);
      appendAssistant(message.text);
    }
    if (message.type === "error") {
      clearStatus();
      setBusy(false);
      appendError(message.text);
    }
  });

  function renderHistory(entries) {
    clearThread();
    for (const entry of entries) {
      if (entry.role === "user") appendUser(entry.content);
      if (entry.role === "assistant") appendAssistant(entry.content);
    }
  }

  function appendUser(text) {
    append("entry user", "You", text, false);
  }

  function appendAssistant(text) {
    append("entry assistant", "Hackl", text, true);
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
    element.scrollIntoView({ block: "end" });
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
    statusEntry.scrollIntoView({ block: "end" });
  }

  function clearStatus() {
    if (statusEntry) {
      statusEntry.remove();
      statusEntry = undefined;
    }
  }

  function clearThread() {
    thread.textContent = "";
    clearStatus();
    setBusy(false);
  }

  function setBusy(busy) {
    send.disabled = busy;
    prompt.disabled = busy;
    clear.disabled = busy;
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
