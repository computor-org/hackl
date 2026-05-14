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
- Optional, opt-in managed llama.cpp lifecycle: hardware probe, five-entry
  curated GGUF catalog with sha256 verification, setup wizard with cancel and
  a BYO-endpoint escape, install/start/stop/swap from a webview, status bar
  item with live tokens/s, `/props` ctx verification. `autoStart` is `false`
  by default; Hackl stays passive until you set it up.
- llama.cpp release archives downloaded by the installer are verified against
  the per-asset sha256 GitHub publishes in the Releases API.
- Registered as a VS Code Language Model provider (vendor `hackl`) so Copilot
  Chat, Continue, and any `vscode.lm.selectChatModels()` consumer see the
  running model.

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

Hackl is BYO-first. If `hackl.endpoint` is set, or any OpenAI-compatible
server is already answering on `localhost:8080` / `:1234`, the install path
stays out of your way. The first-run prompt offers three explicit choices:
**Set up local model**, **Use my own endpoint**, **Not now**.

Run **Hackl: Set up local model** when you want the managed path. The wizard
probes your hardware and recommends one of five curated models:

| Model                              | Size    | sha256 verified | Best fit                          |
|------------------------------------|---------|-----------------|-----------------------------------|
| Qwen3.5 4B (Instruct)              | 2.7 GB  | yes             | 6–8 GB VRAM                       |
| Gemma 4 E4B (Instruct)             | 4.6 GB  | yes             | 8–10 GB VRAM                      |
| Qwen3.5 9B (Instruct)              | 5.5 GB  | yes             | 12–16 GB VRAM                     |
| Gemma 4 26B-A4B (MoE, UD-Q4_K_XL)  | 15.8 GB | yes             | 24 GB VRAM or unified RAM         |
| Qwen3.6 35B-A3B (MoE, UD-Q4_K_XL)  | 20.8 GB | yes             | 32 GB VRAM, or 16 GB with CPU-MoE |

KV cache runs at `q8_0`, flash attention `auto` (CUDA/Metal/Vulkan), MoE
expert offload kicks in on tight VRAM. The wizard previews the exact
`llama-server` flags before installing.

**Supply-chain hardening.** Every GGUF in the catalog is pinned to a sha256
captured from HuggingFace's `x-linked-etag` (LFS sha256). Downloads abort and
delete the partial file on mismatch. llama.cpp release archives are verified
against the per-asset sha256 GitHub publishes in the Releases API `digest`
field. If a release ever omits a digest, Hackl warns in the wizard and
proceeds without verification — there is no silent fallback. The catalog is
capped at five entries on purpose; if you need a different model, use the
BYO endpoint path or point `hackl.endpoint` at a separately-run server.

Settings:

- `hackl.localServer.autoStart` (default `false`) — flip on after a
  successful setup if you want the server to come up with VS Code.
  Conservative by default so the extension stays passive.
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
