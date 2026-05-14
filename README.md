# Hackl

Hackl - hack with local AI.

Hackl is a local-first VS Code coding assistant. It talks to a local
OpenAI-compatible server and keeps Git as the source of truth for review and
history.

Hackl is built around four objects:

- Context: what Hackl should talk about.
- Ask/Edit/Work/Agent: what Hackl may do.
- Annotations: optional structured feedback anchored to source lines.
- Git: the diff and history layer.

Hackl does not manage models, download runtimes, collect telemetry, or require
sign-in. Hosted APIs are not the product story.

## Current Surface

- VS Code Secondary Sidebar chat view.
- Setup panel with LM Studio, llama.cpp, and Ollama recipes.
- Auto-discovery for LM Studio on `:1234` and llama.cpp on `:8080`.
- Local Markdown, code, and LaTeX math rendering in chat.
- Active editor metadata, cursor position, selection range, and capped selected
  text in the prompt.
- Context targets for source ranges, staged changes, the last commit, and
  Markdown sections.
- Ask/Edit/Work/Agent modes with mode-specific tools.
- `/review`: pre-commit review, falling back to the current file.
- Hackl session persistence under `.hackl/sessions/` for annotation runs.

Not in scope:

- Inline autocomplete.
- Custom diff/history UI.
- Model downloader or runtime manager.
- CLI.
- Editor-tab chat panel.
- RAG index.
- Hosted provider presets.
- File mutation outside Edit/Work/Agent mode.

## Connect A Model

Start an OpenAI-compatible server yourself, then point Hackl at it.

| Path | Use when |
|------|----------|
| [LM Studio](https://github.com/computor-org/hackl/blob/main/docs/setup-lmstudio.md) | You want a GUI and a one-click local server. |
| [llama.cpp](https://github.com/computor-org/hackl/blob/main/docs/setup-llamacpp.md) | You want a scriptable OSS runtime. |
| [Ollama](https://github.com/computor-org/hackl/blob/main/docs/setup-ollama.md) | Ollama is already in your stack. |

Set `hackl.endpoint` to the server base URL, for example
`http://localhost:1234/v1`, or leave it empty for local auto-discovery. Run
`Hackl: Check Local Server` to verify endpoint, model, and context window.

If `hackl.endpoint` is not localhost or loopback, Hackl asks before sending a
prompt or selected context.

## Context

Context is the explicit scope for a chat turn. Hackl can include these target
kinds:

- `source-range`: selected code from an editor.
- `staged-changes`: current Git index diff.
- `commit`: last commit diff.
- `markdown-section`: the Markdown section under the cursor.

Attach context from the chat toolbar, editor context menu, command palette, or
SCM title action. Context labels are clickable and reveal the target in the editor.
Clearing chat does not clear Git history; Git remains the durable review layer.

By default, Hackl does not send whole open files. It sends metadata and selected
text up to a cap. When the model needs file bodies, it must request bounded
tool reads:

```text
HACKL_TOOL {"name":"read_file","path":"src/file.ts","start_line":1,"end_line":120}
```

## Modes

Modes control capability, not output format.

| Mode | Tools |
|------|-------|
| Ask | Read-only, bounded `read_file`. |
| Edit | Read files and apply exact `replace_text` edits. |
| Work | Edit plus `search_files` for multi-step code changes. |
| Agent | Work plus approved `run_command` checks. |

Edit, Work, and Agent produce normal file edits. Review them with `git diff`.

## Annotations

Annotations are structured review feedback. `/review` asks the model for a
fenced `hackl-annotations` JSON block. Valid entries become VS Code comment
threads anchored to file lines. Invalid JSON, missing URIs, bad ranges, dropped
entries, and missing annotation blocks are reported instead of silently ignored.

Use `Hackl: Discard Last Annotations Batch` or `Ctrl+Alt+Z` to remove the most
recent AI annotation batch. Use `Hackl: Clear Annotations` to clear all current
annotation threads.

Replies on annotation threads attach that source range and note back to the
context, then reopen chat for follow-up.

## Review

`/review` reviews staged changes with any attached context. If nothing is staged
or attached, it reviews the current file.

`Hackl: Review Staged Changes` is the command-palette entry for the same
pre-commit review loop.

Stage first, run `/review`, inspect annotations, then use Git to amend, unstage,
or commit.

## Sessions

When `hackl.persistSessions` is true, completed annotation runs are written to
`.hackl/sessions/` as Hackl session JSON. Sessions store the mode, endpoint,
model, targets, answer, and generated annotations. Old sessions are pruned on
startup.

## Commands

- `Hackl: Open Chat`
- `Hackl: Open Setup Guide`
- `Hackl: Check Local Server`
- `Hackl: Refresh Endpoint`
- `Hackl: Add Selection to Context`
- `Hackl: Add Markdown Section to Context`
- `Hackl: Add Staged Changes to Context`
- `Hackl: Add Last Commit to Context`
- `Hackl: Clear Context`
- `Hackl: Clear Annotations`
- `Hackl: Discard Last Annotations Batch`
- `Hackl: Review Staged Changes`

## Settings

- `hackl.endpoint`: OpenAI-compatible base URL. Empty means auto-discover.
- `hackl.setupProfile`: setup recipe ordering only.
- `hackl.maxContextTokens`: context-window override for the budget meter.
- `hackl.maxToolFileChars`: cap for one `read_file` result.
- `hackl.enableThinking`: allow reasoning when the server supports it.
- `hackl.debug`: write diagnostics to the Hackl Debug output channel.
- `hackl.persistSessions`: persist annotation runs under `.hackl/sessions/`.

## Architecture

Hackl keeps boundaries small:

- `basket.ts`: internal context target model and state.
- `prompt.ts`: Ask/Edit/Work/Agent prompt assembly.
- `annotations.ts`: annotation parsing and VS Code comment threads.
- `gitTargets.ts`: staged and commit targets.
- `chatSession.ts`: webview session protocol.
- `toolLoop.ts` and `workspaceTools.ts`: bounded model tools.
- `extension.ts`: VS Code command wiring.

The public extension API exposes context operations and session events. It does
not expose a review-specific mode or context API.

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

Live model smoke test:

```bash
npm run smoke:openai -- http://localhost:1234/v1
```

See `docs/architecture.md` for deeper backend/UI notes.
