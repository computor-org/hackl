<p align="center">
  <img src="https://raw.githubusercontent.com/computor-org/hackl/main/packages/vscode/media/hackl-logo.png" alt="Hackl" width="200">
</p>

# Hackl

Hack with local AI.

Hackl is a local-first coding assistant for VS Code. It can install and run a
suitable llama.cpp model, chat about code, edit files, run approved commands,
provide inline completions, and review staged changes. Local use requires no
account or API key. Hackl collects no telemetry.

## Install and start

1. Install Hackl from the Marketplace and open a project.
2. Leave `hackl.endpoint` empty. Hackl selects a model for your hardware and
   starts it when you open chat, request autocomplete, or run **Hackl: Start
   Managed Local Server**.
3. Open the Hackl view or run **Hackl: Open Chat**. The first use downloads a
   verified llama.cpp build and model when needed.

The first download can take several minutes. To download in advance, run
**Hackl: Local Server: Download Model**. Hackl asks for confirmation, shows a
cancellable progress notification, and offers to select the downloaded model
for the next start. The server item in the status bar starts the managed server
when it is stopped and toggles the persistent global startup setting when a
session is active.

Choose **Hackl: Local Server: Select Model for Next Start** to override the
recommendation. Model changes apply on the next start.

## Server lifetime

Hackl does not install a system service, login task, or tray application.

- VS Code, the CLI, and desktop share one temporary managed llama.cpp session.
- The first client owns its model and launch settings.
- The server exits when the last client leaves. A crashed client expires after
  about ten seconds.
- Closing or disabling the extension releases VS Code's client.
- `hackl serve [model]` is the explicit foreground owner; Ctrl+C stops it.

## What it does

| Mode | Capability |
| --- | --- |
| Ask | Read bounded file ranges and explain. |
| Edit | Read and apply exact edits. |
| Work | Edit and search across files. |
| Agent | Work plus approval-gated commands and MCP tools. |
| Yolo | Run model-proposed shell commands without approval. |

Attach selected code, Markdown sections, staged changes, commits, or annotation
threads as explicit context. `/review` turns findings into VS Code comments
anchored to source lines. All edits remain ordinary files you can inspect with
Git.

Inline autocomplete is enabled by default. The managed Qwen models use the same
llama.cpp server for chat and fill-in-the-middle completion.

## Use another server

Set `hackl.endpoint` and optionally `hackl.model`, then run **Hackl: Check Local
Server**.

| Provider | Typical endpoint | Guide |
| --- | --- | --- |
| LM Studio | `http://127.0.0.1:1234/v1` | [Setup](https://github.com/computor-org/hackl/blob/main/docs/setup-lmstudio.md) |
| llama.cpp | `http://127.0.0.1:8080/v1` | [Setup](https://github.com/computor-org/hackl/blob/main/docs/setup-llamacpp.md) |
| Ollama | `http://127.0.0.1:11434/v1` | [Setup](https://github.com/computor-org/hackl/blob/main/docs/setup-ollama.md) |
| OpenRouter | `https://openrouter.ai/api/v1` | [Setup](https://github.com/computor-org/hackl/blob/main/docs/setup-openrouter.md) |

LM Studio and Ollama support chat and agent work but do not expose the
llama.cpp-native completion routes Hackl uses for autocomplete. Configure a
separate llama.cpp endpoint under `hackl.autocomplete.endpoint` if needed.

For an authenticated gateway, run **Hackl: Set API Key**. The key is stored in
VS Code SecretStorage. Hackl asks before sending context to a configured
non-loopback endpoint.

## Essential controls

- **Hackl: Open Chat**
- **Hackl: Toggle Managed Local Server**
- **Hackl: Local Server: Status**
- **Hackl: Local Server: Select Model for Next Start**
- **Hackl: Local Server: Download Model**
- **Hackl: Toggle Inline Autocomplete**
- **Hackl: Add Selection to Context**
- **Hackl: Review Staged Changes**
- `hackl.engine.enabled`: persistent automatic local-server toggle.
- `hackl.endpoint` / `hackl.model`: use an external server.
- `hackl.autocomplete.enabled`: inline completion toggle.

## Safety and privacy

Local prompts stay between VS Code and the selected local server. Hackl has no
telemetry and requires no sign-in for local use. Remote endpoints receive the
prompt and context you send to them.

Agent mode asks before commands outside its safe policy. Yolo mode removes that
approval boundary. Review changes with Git and use Yolo only in a disposable
workspace.

[Source and releases](https://github.com/computor-org/hackl) ·
[Report an issue](https://github.com/computor-org/hackl/issues) · MIT
