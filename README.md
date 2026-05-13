# Hackl

Hackl - hack with local AI.

Hackl is a local-first VS Code chat assistant for coding. It sends the current
editor context to an OpenAI-compatible local chat endpoint and shows the answer
inside VS Code.

## Scope

Current:

- Chat panel.
- Open-file context.
- Active selection and cursor position.
- Command palette, editor context menu, and hotkey entry points.

Not current:

- File edits.
- Custom diffs.
- Autocomplete.
- Hosted API presets.

## Development

```bash
npm install
npm run compile
npm test
```

Configure `hackl.endpoint` and `hackl.model` in VS Code settings.
