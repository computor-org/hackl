# Changelog

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
