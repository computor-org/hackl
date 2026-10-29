# Changelog

## 0.5.0 pre-release

- Formulas in the chat keep their layout again (superscripts and fractions were flattened).
- The agent can create new files (`create_file`); a missing file is reported as missing; Ask and Edit mode can list folders and search.
- "Hackl: Review Staged Changes" starts the review directly, and the raw annotation block is no longer shown.
- The web UI (`hackl serve`) renders markdown and formulas like the VS Code chat.
- `hackl serve` uses a configured endpoint without starting or downloading an engine.
- Model discovery sends the API key, so endpoints that require one work without setting a model by hand.
- Autocomplete falls back to `/v1/completions` when the llama.cpp fill-in-the-middle routes are missing.
- Errors are shown once and name the endpoint for connection and key problems; failed tool calls are reported.
- Requires Node.js 22 or newer for the CLI and VS Code 1.139 or newer for the extension.

## 0.4.0

First stable release of the 0.4 line. It includes the local-first agent, CLI,
managed llama.cpp engine, VS Code chat and autocomplete, and the repaired
release UI smoke test.

## 0.3.7 pre-release

- Default the VS Code chat mode to Agent, matching the CLI and browser server.
- Remember the selected chat mode across VS Code webview reloads.

## 0.3.6 pre-release

- Make Agent mode inspect the workspace before answering orientation questions.
- Use the shared core session loop in VS Code, CLI, and server paths.
- Keep workspace listings filename-only and reuse repeated orientation searches.

## 0.3.5 pre-release

- Add a Hackl chat button alongside Claude Code and Codex in the Secondary Side Bar.
- Fall back to an Activity Bar button on older VS Code and compatible forks.

## 0.3.4 pre-release

- Respect the live context reported by llama.cpp or LM Studio over local overrides.
- Automatically compact long agent tool histories below 75% of the effective context.
- Keep recent turns, bounded factual checkpoints, and deterministic evidence when compaction fails.

## 0.3.3 pre-release

- Add an explicit VS Code model-download flow with confirmation, progress, and cancellation.
- Let model selection configure the next start without silently downloading or starting it.

## 0.3.2 pre-release

- Use lazy managed-engine startup and add an explicit start command.
- Add `hackl models install` and show the selected engine model in CLI output.
- Update the managed llama.cpp release to b10488 and use Q8 KV defaults.

## 0.3.1 pre-release

- Offer to reload the VS Code window when an update leaves the managed-server
  setting temporarily unregistered.

## 0.3.0 pre-release

- Added a managed local llama.cpp setup with hardware-aware model selection.
- Added `hackl serve` for an explicit foreground server and browser UI.
- CLI, VS Code, and desktop now share one temporary client-owned server.
- Added a persistent VS Code status-bar toggle for managed local startup.
- Simplified model commands to `hackl models` and `hackl models remove`.

## 0.2.1

- Security and packaging fixes.
