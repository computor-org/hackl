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
  position.
- On-demand `read_file` tool calls for file content.
- Prompt preprocessing/model phase status, gray reasoning display, and a
  token/context budget indicator.
- Command palette, editor context menu, and hotkey entry points.
- Auto-discovery of common local OpenAI-compatible endpoints.

Not current:

- Custom diffs.
- Inline ghost-text autocomplete (intentionally out of scope; see docs).
- Hosted API presets.

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
override discovery. Hackl uses the loaded model reported by `/v1/models`.

By default, Hackl does not send open-file contents. The prompt contains only
file paths, cursor position, and selection ranges. The model can request a
small file range with:

```text
HACKL_TOOL {"name":"read_file","path":"src/file.ts","start_line":1,"end_line":120}
```

`hackl.maxToolFileChars` caps one file-read result. `hackl.maxContextTokens`
drives the visible prompt budget meter.

See `docs/architecture.md` for the backend/UI boundary and future Computor/Luna
integration notes.

Run a live OpenAI-compatible smoke test with:

```bash
npm run smoke:openai -- http://localhost:1234/v1
```
