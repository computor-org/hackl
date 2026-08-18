# Changelog

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
