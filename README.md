# Hackl

Hackl - hack with local AI.

Hackl is a local-first VS Code assistant for coding. It is the general
local-AI layer for chat now, and later autocomplete, edit mode, and agentic
coding without requiring GitHub Copilot.

## Scope

Current:

- Chat panel.
- Open-file context.
- Active selection and cursor position.
- Command palette, editor context menu, and hotkey entry points.
- Auto-discovery of common local OpenAI-compatible endpoints.

Not current:

- File edits.
- Custom diffs.
- Autocomplete.
- Hosted API presets.

Direction:

- Local Copilot replacement for policy-safe VS Code use.
- Computor/Luna assignment chat surface with optional human tutor escalation.
- One loaded local model by default; no model swap for autocomplete.

## Development

```bash
npm install
npm run compile
npm test
npm run test:coverage
npm run test:extension
npm run package:vsix
```

Hackl auto-discovers llama.cpp on `http://localhost:8080/v1` and LM Studio on
`http://localhost:1234/v1`. Configure `hackl.endpoint` in VS Code settings to
override discovery. Hackl uses the loaded model reported by `/v1/models`.

See `docs/architecture.md` for the backend/UI boundary and future Computor/Luna
integration notes.

Run a live OpenAI-compatible smoke test with:

```bash
npm run smoke:openai -- http://localhost:1234/v1
```
