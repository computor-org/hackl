# Hackl

Hackl - hack with local AI.

Hackl is a local-first VS Code assistant for coding. It is the general
local-AI layer for chat, edit, and agentic coding without requiring GitHub
Copilot.

## Scope

Current:

- Right-side chat view.
- Optional editor chat panel.
- Markdown and local LaTeX math rendering.
- Minimal editor context: open file paths, active selection range, and cursor
  position. Selected text is included up to a small cap.
- Ask/Edit/Work/Agent modes with bounded `read_file`, `search_files`,
  `replace_text`, and approved `run_command` tools by mode.
- Prompt preprocessing/model phase status, gray reasoning display, and a
  token/context budget indicator.
- Command palette, editor context menu, and hotkey entry points.
- Auto-discovery of common local OpenAI-compatible endpoints.
- Built-in llama.cpp lifecycle: hardware probe, curated model catalog, setup
  wizard, install/start/stop/swap from a webview, status bar item.

Not current:

- Custom diffs.
- Inline ghost-text autocomplete (intentionally out of scope; see docs).
- Hosted API presets.
- Auto-approved command mode.

Direction:

- Local chat/edit/agent assistant for policy-safe VS Code use.
- Computor/Luna assignment chat surface with optional human tutor escalation.
- One loaded local model by default.

## Development

```bash
npm install
npm run compile
npm test
npm run test:ui
npm run test:coverage
npm run test:extension
npm run package:vsix
```

Hackl auto-discovers llama.cpp on `http://localhost:8080/v1` and LM Studio on
`http://localhost:1234/v1`. Configure `hackl.endpoint` in VS Code settings to
override discovery. Hackl uses the loaded model reported by `/v1/models`. If
`hackl.endpoint` points outside localhost/loopback, Hackl asks before sending
the prompt or selected context.

## Local model setup

Run **Hackl: Set up local model** from the command palette (or accept the
first-run prompt). The wizard probes your hardware and recommends one of:

| Model                          | Size  | Best fit                  |
|--------------------------------|-------|---------------------------|
| Qwen3.5 4B (Instruct)          | 2.7 GB | 6–8 GB VRAM               |
| Gemma 4 E4B (Instruct)         | 4.6 GB | 8–10 GB VRAM              |
| Qwen3.5 9B (Instruct)          | 5.5 GB | 12–16 GB VRAM             |
| Gemma 4 26B-A4B (MoE, UD-Q4_K_XL) | 15.8 GB | 24 GB VRAM or unified RAM |
| Qwen3.6 35B-A3B (MoE, UD-Q4_K_XL) | 20.8 GB | 32 GB VRAM, or 16 GB with CPU-MoE |

All entries pull verified bartowski/unsloth GGUFs, run with KV cache `q8_0`,
flash attention `auto` (CUDA/Metal/Vulkan), and MoE expert offload on tight
VRAM. The wizard previews the exact `llama-server` flags before installing.

Settings:

- `hackl.localServer.autoStart` (default `true`) — start/stop the server with
  the extension lifecycle.
- `hackl.localServer.port` (default `8080`) — preferred port; Hackl scans up
  to `port+19` if busy.

Models live under `${globalStorage}/models/<id>/` and the llama.cpp binary
under `${globalStorage}/llamacpp/<release-tag>/`. Use **Hackl: Manage local
model** for start/stop/restart/swap and live logs.

By default, Hackl does not send open-file contents. The prompt contains file
paths, cursor position, selection ranges, and selected text capped at 4000
characters. The model can request a small file range with:

```text
HACKL_TOOL {"name":"read_file","path":"src/file.ts","start_line":1,"end_line":120}
```

`hackl.maxToolFileChars` caps one file-read result. File tools reject binary
files, oversized files, and symlinks that resolve outside the workspace.
`hackl.maxContextTokens` drives the visible prompt budget meter. Debug logging
is off by default and can be enabled with `hackl.debug`.

See `docs/architecture.md` for the backend/UI boundary and future Computor/Luna
integration notes.

Run a live OpenAI-compatible smoke test with:

```bash
npm run smoke:openai -- http://localhost:1234/v1
```
