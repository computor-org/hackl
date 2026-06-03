# Hackl

Hack local-first.

Hackl is a local-first VS Code coding assistant for chat, inline autocomplete,
editing, agent work, and commit-level review.

It helps you work on code in the editor, attach explicit context, edit files,
run approved checks, and review changes before they become commits. Hackl keeps
Git as the source of truth: staged changes, commits, source ranges, and
line-anchored annotations are the durable review objects.

Hackl is useful as a normal coding assistant, but its modes also expose a
learning path for responsible AI-assisted coding: ask first, accept small
completions, edit boundedly, work across files, delegate checks, and review
before commit.

Hackl is built around four objects:

- Context: selected code, staged changes, commits, Markdown sections, or annotation notes.
- Modes: capability levels that control what Hackl may do.
- Annotations: human or AI feedback anchored to source lines.
- Git: the diff, staging area, commit, and history layer.

Hackl does not manage models, download runtimes, collect telemetry, or require
sign-in for the local-first workflow.

## Current Surface

- VS Code Secondary Sidebar chat view.
- Get Started walkthrough with LM Studio, llama.cpp, and Ollama recipes.
- Auto-discovery for LM Studio on `:1234` and llama.cpp on `:8080`.
- Local Markdown, code, and LaTeX math rendering in chat.
- Active editor metadata, cursor position, selection range, and capped selected
  text in the prompt.
- Context targets for source ranges, staged changes, the last commit, and
  Markdown sections.
- Ask/Edit/Work/Agent modes with mode-specific tools.
- Inline FIM autocomplete from the same chat model, or a separate endpoint.
- Commit-level `/review` for staged changes, attached context, or the current file.
- Human and AI annotations as line-anchored VS Code comment threads.
- Hackl session persistence in VS Code extension storage for annotation runs.

Not in scope:

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

Inline autocomplete is off by default. Enable it with `Hackl: Toggle Inline
Autocomplete` or `hackl.autocomplete.enabled`. With a llama.cpp chat server it
reuses the loaded Qwen model: the Qwen line ships infill tokens, so the same
model completes code through `/infill`. Leave `hackl.autocomplete.endpoint`
empty for that path.

Autocomplete needs llama.cpp-native `/tokenize` plus `/infill` or `/completion`,
which LM Studio and Ollama do not serve. On those backends, run a small llama.cpp
server for completion and point the autocomplete endpoint at it:

```jsonc
{
  "hackl.endpoint": "http://localhost:1234/v1",
  "hackl.autocomplete.enabled": true,
  "hackl.autocomplete.endpoint": "http://localhost:8084/v1"
}
```

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
| Autocomplete | Inline FIM suggestions only; no file mutation. |
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

## Commit-level review

Hackl gives you a tight local review loop around the change you are about to
commit.

```text
edit -> stage -> review/annotate -> fix -> amend or commit
```

`/review` reviews staged changes with any attached context. If nothing is staged
or attached, it reviews the current file.

Annotations appear as VS Code comment threads. They can come from a human note,
an AI review run, or a follow-up discussion. Replies on annotation threads attach
the source range and note back to context, so comments can drive the next Ask,
Edit, Work, or Agent step.

Use `Hackl: Review Staged Changes` for the same commit-level review loop from
the command palette.

## Sessions

When `hackl.persistSessions` is true, completed annotation runs are written to
VS Code extension storage as Hackl session JSON. Sessions store run metadata,
context targets, the answer, and generated annotations. Old sessions are pruned
on startup.

## Commands

- `Hackl: Open Chat`
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
- `Hackl: Toggle Inline Autocomplete`

## Settings

- `hackl.endpoint`: OpenAI-compatible base URL. Empty means auto-discover.
- `hackl.setupProfile`: setup recipe ordering only.
- `hackl.maxContextTokens`: context-window override for the budget meter.
- `hackl.maxToolFileChars`: cap for one `read_file` result.
- `hackl.enableThinking`: allow reasoning when the server supports it.
- `hackl.reasoningBudget`: token cap on reasoning, sent per request. Stops a
  thinking model from looping in agent mode. Default 4096; -1 unrestricted.
- `hackl.debug`: write diagnostics to the Hackl Debug output channel.
- `hackl.persistSessions`: persist annotation runs in VS Code extension storage.
- `hackl.autocomplete.enabled`: enable inline FIM autocomplete.
- `hackl.autocomplete.endpoint`: optional dedicated autocomplete endpoint.
- `hackl.autocomplete.model`: optional model alias for a routed FIM endpoint.
- `hackl.autocomplete.maxTokens`: token cap for one inline suggestion.
- `hackl.autocomplete.debounceMs`: delay after typing before a request.
- `hackl.autocomplete.multiLine`: allow suggestions past the first newline.
- `hackl.autocomplete.maxPredictMs`: server-side time budget per suggestion.

## Architecture

Hackl keeps boundaries small:

- `basket.ts`: internal context target model and state.
- `prompt.ts`: Ask/Edit/Work/Agent prompt assembly.
- `annotations.ts`: annotation parsing and VS Code comment threads.
- `gitTargets.ts`: staged and commit targets.
- `autocomplete.ts`, `fimClient.ts`, and `fimDetect.ts`: inline FIM suggestions.
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
