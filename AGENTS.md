# Hackl

Hackl is the general `computor-org` local-AI coding assistant.

Brand:
- Name: Hackl.
- Subtitle: hack with local AI.
- Product line: general local-AI coding product, lower-level than Computor.
- Repository: `computor-org/hackl`.
- VS Code extension id: `computor-org.hackl`.
- License: MIT.

Relationship to Computor:
- `computor-vscode` remains course-management UI: login, repositories,
  submissions, grading, tests, course data, and manual/course setup.
- Luna remains the Computor-specific teaching assistant: didactic prompts,
  hints, Socratic behavior, student/course context, optional tutor analytics.
- Hackl owns the generic editor/backend local-AI layer.
- Luna may eventually build on Hackl instead of duplicating editor/backend
  plumbing.

## Product Rules

Local-first:
- No forced sign-in.
- No telemetry.
- Default endpoint is a local OpenAI-compatible server.
- Hosted APIs, including Claude-style APIs, are optional future provider
  adapters only. They are not launch scope and not the brand story.

Workflow:
- Prefer agentic instruction over autocomplete.
- Prefer chat and explicit user instructions over passive inline suggestions.
- Use Git as the history and review layer.
- Do not build a custom diff/history system.
- Edit mode, when added, must present normal file edits for review via `git diff`.
- Users who want history must use Git.
- Autocomplete is last-priority and may never ship. It requires a FIM-trained
  model and must not be implied by chat model support.

Phases:
1. Chat: open a chat from command palette, context menu, or hotkey. Include
   open file metadata by default and use tools for file bodies.
2. Selection/cursor awareness: include highlighted code, active file, and cursor
   position; support right-click and hotkey initiation.
3. Edit mode: apply agentic edits to files and rely on `git diff` for review.
4. Autocomplete: optional future work only, gated on FIM-trained models.

## Current Scope

This repo currently implements phase 1 plus the useful part of phase 2:
- A VS Code chat panel.
- Metadata from currently visible/open text editors.
- Active selection range and cursor position in the prompt context.
- On-demand bounded `read_file` tool calls for file content.
- Right-click and hotkey entry points.
- OpenAI-compatible `/chat/completions` request against a configured endpoint.

Current non-goals:
- No edit mode.
- No file mutation.
- No terminal tool execution.
- No custom diff viewer.
- No RAG index.
- No model downloader.
- No env manager.
- No autocomplete.

## llama.vscode Provenance

Hackl is not a fork of `ggml-org/llama.vscode`.

`llama.vscode` is MIT licensed and useful prior art for VS Code inline
completion, `/infill`, OpenAI-compatible endpoints, env/model management, and
webview agent UX. Do not copy broad architecture or defaults from it. The code
surface is too broad for Hackl: agent prompts, RAG, cloud presets, model
downloaders, training commands, large config defaults, and custom tool surfaces.

Allowed use:
- Read it for protocol and VS Code API edge cases.
- Copy only small, proven pieces when they save real implementation risk.
- When copying or closely adapting code, keep the original copyright and MIT
  notice in `THIRD_PARTY.md` and in copied-file headers where practical.
- When reimplementing ideas without copied code, mention the influence in
  `THIRD_PARTY.md` but do not claim code provenance.

## Engineering Rules

- Keep modules below 500 lines; hard limit 1000.
- Keep functions below 50 lines; hard limit 100.
- Validate external configuration at boundaries.
- Keep provider logic behind small interfaces.
- Keep VS Code UI code separate from request/context logic.
- Do not add shallow wrappers.
- Do not hardcode secrets.
- Store API keys only through VS Code secret storage when key support is added.
- Keep commands explicit and discoverable.
- Comments explain why, not what.

## Repo Tooling

Use npm scripts from this repo:

```bash
npm install
npm run compile
npm test
```

Do not invent build commands when package scripts exist.

## Git Rules

- Stage paths explicitly.
- Never `git add .` or `git add -A`.
- Keep commits specific and human-readable.
- Private repository while Hackl is pre-release.
