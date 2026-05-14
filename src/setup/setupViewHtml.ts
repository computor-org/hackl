import * as vscode from "vscode";

export function renderSetupHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hackl — Setup</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="wrap">
    <div id="status" class="status status-probing">
      <span class="pill">probing</span>
      <span id="status-text">Looking for a local OpenAI-compatible server…</span>
    </div>

    <div class="row">
      <button id="refresh" class="primary" type="button">Refresh</button>
      <span class="profile">Profile: <span id="profile">auto</span></span>
    </div>

    <div class="tiers">
      <strong>Model tiers</strong>
      <table>
        <thead><tr><th>Tier</th><th>RAM/VRAM</th><th>Qwen</th><th>Gemma</th></tr></thead>
        <tbody>
          <tr><td>S</td><td>4–8 GB</td><td><code>Qwen3 4B-Instruct</code></td><td><code>Gemma 3n E2B-it</code></td></tr>
          <tr><td>M</td><td>12–16 GB</td><td><code>Qwen3 8B</code></td><td><code>Gemma 3n E4B-it</code></td></tr>
          <tr><td>L</td><td>24 GB+</td><td><code>Qwen3 14B</code> / <code>Qwen3-30B-A3B</code></td><td><code>Gemma 3 12B-it</code> / <code>27B-it</code></td></tr>
        </tbody>
      </table>
    </div>

    <details id="lmstudio" class="card">
      <summary><strong>LM Studio</strong> · easy</summary>
      <ol>
        <li>Install LM Studio (<button class="linklike" type="button" data-link="https://lmstudio.ai/">lmstudio.ai</button>) and open it once.</li>
        <li>Search a GGUF matching your tier (see table above).</li>
        <li>Load the model and try a quick chat in LM Studio's UI.</li>
        <li>Open <em>Developer</em> → start the local server.</li>
        <li>Point Hackl at it:</li>
      </ol>
      <div class="actions">
        <button data-set="http://127.0.0.1:1234/v1" type="button">Set endpoint to :1234/v1</button>
        <button data-doc="lmstudio" type="button">Open full guide</button>
      </div>
    </details>

    <details id="llamacpp" class="card">
      <summary><strong>llama.cpp</strong> · control</summary>
      <p>Install:</p>
      <pre><code>brew install llama.cpp           # macOS
winget install llama.cpp         # Windows
# Linux: github.com/ggml-org/llama.cpp/releases</code></pre>
      <p>Tier M (Qwen 8B):</p>
      <pre><code>llama-server \\
  -hf bartowski/Qwen_Qwen3-8B-GGUF:Q4_K_M \\
  -c 32768 --cache-type-k q8_0 --cache-type-v q8_0 \\
  -ngl auto -fa on --alias qwen-local --jinja \\
  --host 127.0.0.1 --port 8080</code></pre>
      <p>Tier M (Gemma 3n E4B):</p>
      <pre><code>llama-server -hf ggml-org/gemma-3n-E4B-it-GGUF:Q4_0 \\
  -c 32768 -ngl auto -fa on --jinja \\
  --host 127.0.0.1 --port 8080</code></pre>
      <div class="actions">
        <button data-set="http://127.0.0.1:8080/v1" type="button">Set endpoint to :8080/v1</button>
        <button data-doc="llamacpp" type="button">Open full guide</button>
      </div>
    </details>

    <details id="ollama" class="card">
      <summary><strong>Ollama</strong> · alternative</summary>
      <pre><code>ollama serve
# Tier S
ollama pull qwen3:4b      # or gemma3n:e2b
# Tier M
ollama pull qwen3:8b      # or gemma3n:e4b
# Tier L
ollama pull qwen3-coder:30b   # or gemma3:12b</code></pre>
      <p class="hint">Ollama exposes <code>/v1</code> on port 11434 but has model-name and <code>/props</code> quirks.</p>
      <div class="actions">
        <button data-set="http://127.0.0.1:11434/v1" type="button">Set endpoint to :11434/v1</button>
        <button data-doc="ollama" type="button">Open full guide</button>
      </div>
    </details>

    <p class="footer">Hackl never starts a server. You run the model; Hackl connects to it.</p>
  </div>
  <script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  return nonce;
}

const STYLES = `
  body { font-family: var(--vscode-font-family, system-ui); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
  .wrap { padding: 14px 14px 24px; max-width: 100%; }
  .status { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 4px; margin-bottom: 12px; background: var(--vscode-editorWidget-background); }
  .pill { font-size: 10px; padding: 2px 8px; border-radius: 999px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
  .status-ok .pill { background: rgba(60, 180, 100, 0.25); color: #4ade80; }
  .status-none .pill { background: rgba(220, 60, 60, 0.22); color: #f87171; }
  .row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .profile { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .card { background: var(--vscode-editorWidget-background, transparent); border: 1px solid var(--vscode-panel-border, transparent); border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; }
  .card summary { cursor: pointer; font-size: 13px; }
  .card[open] summary { margin-bottom: 8px; }
  .card ol { margin: 6px 0 8px 18px; padding: 0; }
  .card li { margin: 3px 0; font-size: 12px; }
  .card pre { background: var(--vscode-textCodeBlock-background); padding: 8px 10px; border-radius: 4px; overflow-x: auto; font-size: 11px; margin: 6px 0; }
  .card code { font-family: var(--vscode-editor-font-family, monospace); }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  button { background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-panel-border, var(--vscode-foreground)); padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  a { color: var(--vscode-textLink-foreground); }
  button.linklike { background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground); text-decoration: underline; cursor: pointer; font: inherit; }
  button.linklike:hover { color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground)); }
  .hint { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .footer { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 18px; }
  .tiers { display: block; margin: 8px 0 14px; font-size: 12px; }
  .tiers table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  .tiers th, .tiers td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--vscode-panel-border, transparent); font-size: 11px; }
  .tiers th { font-weight: 600; color: var(--vscode-descriptionForeground); }
`;

const SCRIPT = `
  const vscode = acquireVsCodeApi();
  function setStatus(state, text) {
    const el = document.getElementById('status');
    el.className = 'status status-' + state;
    el.querySelector('.pill').textContent = state === 'ok' ? 'connected' : state === 'none' ? 'no server' : 'probing';
    document.getElementById('status-text').textContent = text;
  }
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  for (const btn of document.querySelectorAll('button[data-set]')) {
    btn.addEventListener('click', () => vscode.postMessage({ type: 'setEndpoint', endpoint: btn.dataset.set }));
  }
  for (const btn of document.querySelectorAll('button[data-doc]')) {
    btn.addEventListener('click', () => vscode.postMessage({ type: 'openDoc', doc: btn.dataset.doc }));
  }
  for (const a of document.querySelectorAll('[data-link]')) {
    a.addEventListener('click', (e) => { e.preventDefault(); vscode.postMessage({ type: 'openLink', href: a.dataset.link }); });
  }
  function focusProfile(profile) {
    document.getElementById('profile').textContent = profile;
    if (profile === 'lmstudio' || profile === 'llamacpp' || profile === 'ollama') {
      const target = document.getElementById(profile);
      if (target) target.open = true;
    }
  }
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'status') {
      if (m.connected) {
        const ctx = m.ctx ? ' · ' + Math.floor(m.ctx / 1024) + 'k ctx' : '';
        setStatus('ok', m.endpoint + ' · ' + (m.model || 'model') + ctx);
      } else {
        setStatus('none', 'No local server detected on any candidate endpoint.');
      }
      if (m.profile) focusProfile(m.profile);
    }
  });
  vscode.postMessage({ type: 'ready' });
`;
