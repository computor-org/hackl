import * as vscode from "vscode";
import { randomBytes } from "node:crypto";

export function renderSetupHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString("hex");
  const css = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "setup", "main.css"));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "setup", "main.js"));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hackl - Setup</title>
  <link rel="stylesheet" href="${css}">
</head>
<body>
  <div class="wrap">
    <div id="status" class="status status-probing">
      <span class="pill">probing</span>
      <span id="status-text">Looking for a model backend...</span>
    </div>

    <div class="row">
      <button id="refresh" class="primary" type="button">Refresh</button>
      <span class="profile">Local profile: <span id="profile">auto</span></span>
    </div>

    <div class="columns">
      <section class="column">
        <h2>Local AI</h2>
        <p class="lede">Run an OpenAI-compatible server on this machine. Hackl never starts it for you.</p>

        <div class="tiers">
          <strong>Chat model tiers</strong>
          <table>
            <thead><tr><th>Tier</th><th>RAM/VRAM</th><th>Qwen</th><th>Gemma</th></tr></thead>
            <tbody>
              <tr><td>S</td><td>4-8 GB</td><td><code>Qwen3 4B-Instruct</code></td><td><code>Gemma 3n E2B-it</code></td></tr>
              <tr><td>M</td><td>12-16 GB</td><td><code>Qwen3 8B</code></td><td><code>Gemma 3n E4B-it</code></td></tr>
              <tr><td>L</td><td>24 GB+</td><td><code>Qwen3-Coder 30B-A3B</code> / <code>Qwen3 14B</code></td><td><code>Gemma 3 12B-it</code> / <code>27B-it</code></td></tr>
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
          <p>Autocomplete FIM endpoint (Qwen2.5-Coder 7B):</p>
          <pre><code>llama-server \\
  -hf Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M \\
  -c 32768 --cache-type-k q8_0 --cache-type-v q8_0 \\
  -ngl auto -fa on --alias qwenfim --jinja \\
  --temp 0.15 --top-p 0.9 --top-k 40 \\
  --host 127.0.0.1 --port 8084</code></pre>
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
      </section>

      <section class="column">
        <h2>Codex</h2>
        <p class="lede">Use the OpenAI Codex CLI you already logged into. Hackl spawns <code>codex app-server</code> on demand and re-uses your session, with no API keys to manage.</p>

        <div id="codex-card" class="card open">
          <div id="codex-state" class="codex-state codex-state-missing">
            <span class="codex-pill">checking</span>
            <span id="codex-state-text">Looking for the codex CLI...</span>
          </div>

          <div id="codex-install" hidden>
            <p>Install the Codex CLI:</p>
            <pre><code>npm install -g @openai/codex</code></pre>
            <p class="hint">Already installed in a custom location? Set <code>hackl.codex.command</code> in settings.</p>
            <div class="actions">
              <button id="codex-recheck" type="button">Recheck</button>
              <button class="linklike" type="button" data-link="https://developers.openai.com/codex/cli">Open Codex CLI docs</button>
            </div>
          </div>

          <div id="codex-login" hidden>
            <p>Codex is installed but not logged in. Run:</p>
            <pre><code>codex login</code></pre>
            <div class="actions">
              <button id="codex-run-login" class="primary" type="button">Run <code>codex login</code> in a terminal</button>
              <button id="codex-recheck-2" type="button">Recheck</button>
            </div>
          </div>

          <div id="codex-ready" hidden>
            <p>Codex is ready. Pick a model:</p>
            <ul id="codex-models" class="codex-models"></ul>
            <div class="actions">
              <button id="codex-use" class="primary" type="button" disabled>Use selected Codex model</button>
              <button id="codex-recheck-3" type="button">Recheck</button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div class="dismiss">
      <label>
        <input id="hint-dismiss" type="checkbox">
        Don't show the connect hint on startup
      </label>
    </div>

    <p class="footer">Hackl never starts a server. You run the model locally or via Codex, and Hackl connects to it.</p>
  </div>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
}
