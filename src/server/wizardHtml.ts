import * as vscode from "vscode";

export function renderWizardHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hackl — Set up local model</title>
  <style>${WIZARD_STYLES}</style>
</head>
<body>
  <main class="wrap">
    <header class="hero">
      <h1>Set up your local model</h1>
      <p class="lede">Hackl will install llama.cpp, download a curated GGUF model, and tune the server for your hardware. Everything runs locally.</p>
    </header>

    <section class="card hardware">
      <header><h2>1. Hardware</h2></header>
      <div id="hw-content" class="hw-grid">
        <div class="hw-skeleton">Probing system...</div>
      </div>
    </section>

    <section class="card models">
      <header><h2>2. Choose a model</h2><span id="rec-tag" class="tag" hidden>Recommended for your machine</span></header>
      <div id="model-list" class="model-list"></div>
    </section>

    <section class="card confirm" id="confirm-card" hidden>
      <header><h2>3. Confirm</h2></header>
      <div id="confirm-content"></div>
      <div class="actions">
        <button id="install" class="primary" type="button">Install and start</button>
      </div>
    </section>

    <section class="card progress-card" id="progress-card" hidden>
      <header><h2>Setting up...</h2></header>
      <div class="progress-message" id="progress-message">Preparing...</div>
      <div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div>
      <div class="actions">
        <button id="cancel" type="button">Cancel</button>
      </div>
    </section>
  </main>
  <script nonce="${nonce}">${WIZARD_SCRIPT}</script>
</body>
</html>`;
}

function getNonce(): string {
  const text = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) nonce += text.charAt(Math.floor(Math.random() * text.length));
  return nonce;
}

const WIZARD_STYLES = `
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family, system-ui);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: 0;
    line-height: 1.45;
  }
  .wrap { max-width: 880px; margin: 0 auto; padding: 32px 28px 80px; }
  .hero h1 { margin: 0 0 6px; font-size: 22px; font-weight: 600; }
  .lede { margin: 0 0 28px; color: var(--vscode-descriptionForeground); }
  .card {
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-panel-border, transparent);
    border-radius: 8px;
    padding: 20px 22px;
    margin-bottom: 18px;
  }
  .card header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .card h2 { margin: 0; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; color: var(--vscode-descriptionForeground); }
  .tag {
    font-size: 11px;
    background: var(--vscode-textLink-foreground);
    color: var(--vscode-editor-background);
    padding: 2px 8px;
    border-radius: 999px;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
  }
  .hw-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
  }
  .hw-cell .label { font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; }
  .hw-cell .value { font-size: 14px; font-weight: 500; margin-top: 2px; }
  .hw-skeleton { color: var(--vscode-descriptionForeground); font-style: italic; }

  .model-list { display: flex; flex-direction: column; gap: 10px; }
  .model-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 14px;
    align-items: center;
    padding: 14px 16px;
    border: 1px solid var(--vscode-panel-border, transparent);
    border-radius: 6px;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease;
  }
  .model-row:hover { background: var(--vscode-list-hoverBackground); }
  .model-row.selected { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); }
  .model-row.recommended { box-shadow: inset 0 0 0 1px var(--vscode-textLink-foreground); }
  .model-row input[type=radio] { accent-color: var(--vscode-textLink-foreground); }
  .model-info .name { font-weight: 600; }
  .model-info .meta { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .badge { font-size: 11px; padding: 3px 9px; border-radius: 999px; font-weight: 600; }
  .badge.full { background: rgba(60, 180, 100, 0.18); color: #4ade80; }
  .badge.partial { background: rgba(245, 180, 70, 0.18); color: #facc15; }
  .badge.no { background: rgba(220, 60, 60, 0.18); color: #f87171; }

  .confirm dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; margin: 0; }
  .confirm dt { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .confirm dd { margin: 0; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; word-break: break-word; }
  .confirm .flags { background: var(--vscode-textCodeBlock-background); padding: 10px 12px; border-radius: 4px; margin-top: 12px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; white-space: pre-wrap; }
  .actions { margin-top: 16px; display: flex; justify-content: flex-end; }
  .primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 8px 18px;
    border-radius: 4px;
    font-weight: 500;
    cursor: pointer;
  }
  .primary:hover { background: var(--vscode-button-hoverBackground); }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }

  .progress-card { border-color: var(--vscode-focusBorder); }
  .progress-message { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; margin-bottom: 10px; }
  .progress-bar { height: 6px; background: var(--vscode-progressBar-background, rgba(255,255,255,0.1)); border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; width: 0; background: var(--vscode-textLink-foreground); transition: width 200ms ease; }
`;

const WIZARD_SCRIPT = `
  const vscode = acquireVsCodeApi();
  let status = null;
  let selectedId = null;

  function formatBytes(n) {
    if (!n) return '0 GB';
    const gb = n / (1024 ** 3);
    return gb >= 10 ? gb.toFixed(0) + ' GB' : gb.toFixed(1) + ' GB';
  }

  function describeBackend(b) {
    return { cuda: 'NVIDIA CUDA', rocm: 'AMD ROCm', metal: 'Apple Metal', vulkan: 'Vulkan', cpu: 'CPU only' }[b] || b;
  }

  function renderHardware(hw) {
    const cells = [
      ['Platform', hw.platform + ' / ' + hw.arch],
      ['Backend', describeBackend(hw.backend)],
      ['GPU', hw.gpuName || (hw.gpuVendor || 'none')],
      ['VRAM', hw.vramTotalBytes ? formatBytes(hw.vramTotalBytes) : '—'],
      ['System RAM', formatBytes(hw.totalRamBytes) + ' total · ' + formatBytes(hw.freeRamBytes) + ' free'],
      ['CPU cores', String(hw.physicalCores)],
    ];
    document.getElementById('hw-content').innerHTML = cells.map(([l,v]) => '<div class="hw-cell"><div class="label">' + l + '</div><div class="value">' + v + '</div></div>').join('');
  }

  function renderModels(rec, models) {
    const html = rec.fits.map(fit => {
      const m = models.find(x => x.id === fit.modelId);
      const isRec = rec.recommendedId === fit.modelId;
      const badge = '<span class="badge ' + fit.fits + '">' + ({full:'Full GPU', partial:'Partial GPU', no:"Won't fit"})[fit.fits] + '</span>';
      const ctxK = Math.floor(fit.ctxSize / 1024) + 'k';
      const meta = m.paramsB + 'B params' + (m.isMoE ? ' · ' + m.activeParamsB + 'B active' : '') + ' · ' + m.quant.replace('_',' ').toUpperCase() + ' · ' + ctxK + ' ctx';
      return '<label class="model-row' + (isRec ? ' recommended' : '') + '" data-id="' + m.id + '">' +
        '<input type="radio" name="model" value="' + m.id + '"' + (isRec ? ' checked' : '') + '>' +
        '<div class="model-info"><div class="name">' + m.displayName + (isRec ? ' · <em style="color: var(--vscode-textLink-foreground); font-style: normal;">recommended</em>' : '') + '</div><div class="meta">' + meta + '</div></div>' +
        badge + '</label>';
    }).join('');
    document.getElementById('model-list').innerHTML = html;
    document.getElementById('rec-tag').hidden = !rec.recommendedId;
    document.querySelectorAll('.model-row').forEach(row => {
      row.addEventListener('click', () => selectModel(row.dataset.id));
    });
    if (rec.recommendedId) selectModel(rec.recommendedId);
  }

  function selectModel(id) {
    selectedId = id;
    document.querySelectorAll('.model-row').forEach(r => {
      r.classList.toggle('selected', r.dataset.id === id);
      const input = r.querySelector('input');
      if (input) input.checked = r.dataset.id === id;
    });
    renderConfirm();
  }

  function renderConfirm() {
    const fit = status.recommendation.fits.find(f => f.modelId === selectedId);
    const model = status.models.find(m => m.id === selectedId);
    if (!fit || !model) return;
    const card = document.getElementById('confirm-card');
    card.hidden = false;
    const flags = buildFlagPreview(model, fit);
    const cells = [
      ['Model', model.displayName],
      ['File', model.hfRepo + ' / ' + model.ggufFile],
      ['Download size (approx.)', formatBytes(model.weightBytes)],
      ['GPU layers', fit.nGpuLayers === 99 ? 'all' : String(fit.nGpuLayers)],
      ['Context', Math.floor(fit.ctxSize / 1024) + 'k tokens'],
      ['KV cache', fit.cacheTypeK + ' / ' + fit.cacheTypeV],
      ['Notes', fit.notes.join(' ')],
    ];
    document.getElementById('confirm-content').innerHTML =
      '<dl>' + cells.map(([k,v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + '</dl>' +
      '<div class="flags">' + flags + '</div>';
  }

  function buildFlagPreview(model, fit) {
    const parts = ['llama-server',
      '-m <' + model.ggufFile + '>',
      '-c ' + fit.ctxSize,
      '-ngl ' + fit.nGpuLayers,
      '--cache-type-k ' + fit.cacheTypeK,
      '--cache-type-v ' + fit.cacheTypeV,
      '--threads ' + fit.threads,
      '--jinja'];
    if (fit.flashAttn === 'auto') parts.push('-fa on');
    if (fit.cpuMoe) parts.push('--n-cpu-moe ' + fit.cpuMoe);
    return parts.join(' \\\\\\n  ');
  }

  document.getElementById('install').addEventListener('click', () => {
    if (!selectedId) return;
    vscode.postMessage({ type: 'install', modelId: selectedId });
  });
  document.getElementById('cancel').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'status') {
      status = msg.status;
      renderHardware(status.hardware);
      renderModels(status.recommendation, status.models);
    } else if (msg.type === 'progress') {
      const card = document.getElementById('progress-card');
      card.hidden = false;
      document.getElementById('progress-message').textContent = msg.message || '...';
      if (typeof msg.fraction === 'number') {
        document.getElementById('progress-fill').style.width = Math.round(msg.fraction * 100) + '%';
      }
    } else if (msg.type === 'done') {
      document.getElementById('progress-card').hidden = true;
    }
  });

  vscode.postMessage({ type: 'ready' });
`;
