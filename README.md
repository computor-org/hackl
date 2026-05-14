# Hackl

Hackl - hack with local AI.

Hackl is a local-first VS Code assistant for coding. It is the general
local-AI layer for chat, edit, and agentic coding without requiring GitHub
Copilot.

> Hackl does not manage models. Hackl connects to your local OpenAI-compatible
> server. Use LM Studio if you want easy. Use llama.cpp if you want control.

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
- Auto-discovery of common local OpenAI-compatible endpoints (llama.cpp on
  `:8080`, LM Studio on `:1234`).
- A small **Setup** view with tutorial recipes for LM Studio, llama.cpp, and
  Ollama. Status bar shows current connection or "connect".

Not current:

- Custom diffs.
- Inline ghost-text autocomplete (intentionally out of scope; see docs).
- Hosted API presets.
- Auto-approved command mode.
- **No managed server, no model downloader, no GPU probe, no installer.**
  Hackl pre-`0.0.27` shipped these; they were removed to keep the extension
  minimal. The `v0.0.26` vsix on the releases page is the last version that
  managed llama.cpp itself.

## Connect to a local model

Hackl is BYO-server. Pick one of these paths — Hackl ships docs and a setup
view that links to each:

| Path | Difficulty | When to use it |
|------|------------|----------------|
| [LM Studio](https://github.com/computor-org/hackl/blob/main/docs/setup-lmstudio.md) | easy | GUI download + start server with one click |
| [llama.cpp](https://github.com/computor-org/hackl/blob/main/docs/setup-llamacpp.md) | expert | scriptable, reproducible, pure OSS |
| [Ollama](https://github.com/computor-org/hackl/blob/main/docs/setup-ollama.md) | alternative | already part of your stack |

Once your server is running, set `hackl.endpoint` to its base URL (or let
auto-discovery find `:8080` / `:1234`). Run **Hackl: Check Local Server**
from the command palette to verify.

## Settings

- `hackl.endpoint` — OpenAI-compatible base URL. Empty means auto-discover.
- `hackl.setupProfile` — `auto` / `lmstudio` / `llamacpp` / `ollama`.
  Help-text only; foregrounds the matching recipe in the Setup view. Never
  starts a process.
- `hackl.maxContextTokens` — override for the prompt-budget meter. When
  unset, Hackl auto-detects via `/props` (llama.cpp) or `/api/v0/models`
  (LM Studio) and falls back to 32768.
- `hackl.maxToolFileChars` — cap for one `read_file` tool result.
- `hackl.enableThinking` — allow model thinking/reasoning when the server
  supports it.
- `hackl.debug` — write diagnostics to the Hackl Debug output channel.

If `hackl.endpoint` points outside localhost/loopback, Hackl asks before
sending any prompt.

## Commands

- **Hackl: Open Chat** / **Open Chat in Editor**
- **Hackl: Open Setup Guide** — opens the Setup view.
- **Hackl: Check Local Server** — probes configured + default endpoints,
  reports endpoint, model, context.
- **Hackl: Refresh Endpoint** — clears the detected-context cache and
  re-probes after you start a server externally.

## File context

By default, Hackl does not send open-file contents. The prompt contains
file paths, cursor position, selection ranges, and selected text capped at
4000 characters. The model can request a small file range with:

```text
HACKL_TOOL {"name":"read_file","path":"src/file.ts","start_line":1,"end_line":120}
```

`hackl.maxToolFileChars` caps one file-read result. File tools reject binary
files, oversized files, and symlinks that resolve outside the workspace.

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

Run a live OpenAI-compatible smoke test with:

```bash
npm run smoke:openai -- http://localhost:1234/v1
```

See `docs/architecture.md` for the backend/UI boundary and future
Computor/Luna integration notes.
