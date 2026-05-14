import * as vscode from "vscode";

export function renderPanelHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Hackl — Local model</title>
  <style>${PANEL_STYLES}</style>
</head>
<body>
  <main class="wrap">
    <header>
      <h1 id="title">Local model</h1>
      <span id="state-pill" class="pill">unknown</span>
    </header>
    <dl id="info"></dl>
    <div class="actions">
      <button id="start" class="primary" type="button">Start</button>
      <button id="stop" type="button">Stop</button>
      <button id="restart" type="button">Restart</button>
      <button id="swap" type="button">Swap model</button>
      <button id="logs" type="button">Open logs</button>
    </div>
  </main>
  <script nonce="${nonce}">${PANEL_SCRIPT}</script>
</body>
</html>`;
}

function getNonce(): string {
  const text = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) nonce += text.charAt(Math.floor(Math.random() * text.length));
  return nonce;
}

const PANEL_STYLES = `
  body { font-family: var(--vscode-font-family, system-ui); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 28px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0; }
  .pill { font-size: 11px; padding: 3px 10px; border-radius: 999px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; }
  .pill.ready { background: rgba(60, 180, 100, 0.22); color: #4ade80; }
  .pill.starting, .pill.stopping { background: rgba(245, 180, 70, 0.22); color: #facc15; }
  .pill.error { background: rgba(220, 60, 60, 0.22); color: #f87171; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; margin: 0 0 18px; }
  dt { color: var(--vscode-descriptionForeground); font-size: 12px; }
  dd { margin: 0; font-size: 13px; word-break: break-word; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  button { background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-panel-border, var(--vscode-foreground)); padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
`;

const PANEL_SCRIPT = `
  const vscode = acquireVsCodeApi();
  function formatBytes(n) { if (!n) return '—'; const gb = n / (1024 ** 3); return gb.toFixed(1) + ' GB'; }
  function render(status) {
    document.getElementById('state-pill').textContent = status.phase;
    document.getElementById('state-pill').className = 'pill ' + status.phase;
    const cells = [
      ['Model', status.modelDisplayName || '(none configured)'],
      ['Endpoint', status.endpoint || '—'],
      ['Port', status.port || '—'],
      ['Backend', status.hardware ? status.hardware.backend : '—'],
      ['VRAM', status.hardware && status.hardware.vramTotalBytes ? formatBytes(status.hardware.vramTotalBytes) : '—'],
      ['Context (live)', status.actualCtxSize ? (Math.floor(status.actualCtxSize / 1024) + 'k tokens') : '—'],
      ['Generation', status.lastTokensPerSecond ? (status.lastTokensPerSecond.toFixed(1) + ' tokens/s') : '—'],
    ];
    document.getElementById('info').innerHTML = cells.map(([k,v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('');
  }
  for (const id of ['start','stop','restart','swap','logs']) {
    document.getElementById(id).addEventListener('click', () => vscode.postMessage({ type: id }));
  }
  window.addEventListener('message', (e) => { if (e.data?.type === 'status') render(e.data.status); });
  vscode.postMessage({ type: 'ready' });
`;
