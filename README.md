<p align="center">
  <img src="packages/vscode/media/hackl-logo.png" alt="Hackl" width="200">
</p>

<h1 align="center">Hackl</h1>

<p align="center">Hack local-first.</p>

Hackl is a local-first AI coding assistant. It talks to a local OpenAI-compatible
server (llama.cpp, LM Studio, Ollama) by default, with no forced sign-in and no
telemetry. The agent backend is shared between a VS Code extension and a terminal
CLI, and both expose Model Context Protocol (MCP) tools.

## Purpose

Hackl is built for Computor, a platform for stepwise programming education. The
graded capability modes exist so a course can hand students an assistant that
reads and explains before it edits, and edits before it runs commands. A student
learns each step under a tool budget instead of getting a finished solution.

That focus does not limit the tool. Hackl is also a general-purpose local AI
coding harness: the same shared core drives the CLI, the VS Code extension, and
MCP tools for everyday work outside any course.

## Responsibility

You are responsible for how you use Hackl and for what its agent does to your
files and system. Read the diff before you keep it, work on a clean branch or in
a sandbox, and keep backups. Local models are fallible and will sometimes
propose wrong or destructive changes.

Modes set how much the agent may do without asking:

| Mode | Capability |
| --- | --- |
| Ask | read only |
| Edit | read and exact edits |
| Work | read, edit, and search |
| Agent | the above plus structured commands, each approval-gated |
| Yolo | the above with no command policy and no approval: runs any shell command |

Yolo mode (`--yolo` or `--mode yolo` in the CLI, the Yolo entry in the VS Code
mode menu) removes the safeguards on purpose. It runs whatever command the model
emits, including pipes and redirects, with no confirmation. Use it only when you
accept that risk and the workspace is disposable.

## Packages

This repository is an npm workspace.

| Package | Description |
| --- | --- |
| [`@hackl/core`](packages/core) | Frontend-agnostic agent loop, tools, backends, MCP client, and session. |
| [`@hackl/protocol`](packages/protocol) | Client/server WebSocket wire types shared by the server and the web UI. |
| [`@hackl/server`](packages/server) | Internal localhost WebSocket server used by `hackl serve` and desktop. |
| [`@hackl/webui`](packages/webui) | The shared browser/desktop chat UI, dependency-free, talking to the server. |
| [`hackl` (VS Code)](packages/vscode) | In-editor chat with capability modes and Git-anchored annotations, plus inline autocomplete. |
| [`@hackl/cli`](packages/cli) | The `hackl` terminal frontend: one-shot, REPL, and NDJSON. |

## Web GUI

`hackl serve` runs the same agent loop as the CLI and extension behind a
loopback WebSocket and serves the shared web UI:

```bash
hackl serve --open
```

It binds `127.0.0.1` only and prints a one-time URL carrying an auth token; the
server immediately swaps the token into an `HttpOnly` cookie and redirects, so it
never lingers in the address bar. All five modes are available (default agent);
yolo requires `--allow-yolo`. The same UI is the basis for the desktop app. See
[`SECURITY.md`](SECURITY.md).

## Build and test

```bash
npm install
npm run build      # build every package
npm test           # run the full workspace test suite
npm run build:cli  # bundle the standalone CLI
npm run package:vsix
```

The CLI and the VS Code extension are esbuild bundles with no runtime
`node_modules`: the MCP SDK is inlined into each artifact.

## Managed local engine

`hackl` can set up and run llama.cpp for you, sized to your machine, all on
localhost:

```sh
hackl serve [model]          # foreground engine + both browser UIs
hackl models                 # catalog, recommendation, install and active state
hackl models remove <model>  # reclaim managed model storage
```

`hackl serve` stays in the foreground and Ctrl+C stops it. Ordinary CLI, VS Code,
and desktop clients share one temporary background session; it exits when the
last clean client leaves or about ten seconds after crashed clients stop
heartbeating. The first starter owns the model and launch settings. There is no
installed service, login task, or tray process.

An existing OpenAI-compatible server is adopted read-only and never stopped.
The managed server binds `127.0.0.1` by default; `--allow-remote` opts into
`0.0.0.0`. `hackl serve` prints both Hackl's UI and llama.cpp's own WebUI.

Model choice is hardware-aware (`recommendModel`): it picks the largest catalog
model that fits, spanning a 1.5B coder up to the Qwen3.6-35B-A3B MoE. Two rules
worth knowing: the **35B-A3B MoE decodes faster than the dense 27B** (about 3B
active params), so it is preferred when it fits; and at **~16 GB, Qwen 9B is
preferred over Gemma 12B** (it fits better, ships FIM tokens, and is stronger at
code). Knobs (context, n-cpu-moe, KV quant, MTP, mmproj, threads, ...) default
from the probe and are overridable per model.

VS Code starts or joins the session on activation. Its server status item
directly toggles the global, persistent `hackl.engine.enabled` setting. Turning
it off releases VS Code's lease without changing autocomplete, other clients,
manual `hackl serve`, LM Studio, Ollama, or remote providers. See
[`docs/setup-llamacpp.md`](docs/setup-llamacpp.md).

## Remote endpoints (OpenRouter)

The default is keyless and local. For a hosted gateway like OpenRouter, set the
endpoint, model, and an API key. The CLI reads the key from `HACKL_API_KEY`, the
`apiKey` config field, or `--api-key`:

```sh
export HACKL_API_KEY="sk-or-..."
hackl --endpoint https://openrouter.ai/api/v1 --model qwen/qwen3-coder:free "explain this repo"
```

In VS Code, set `hackl.endpoint` and `hackl.model`, then run `Hackl: Set API
Key`. The key is stored in VS Code SecretStorage, never in settings.json. Free
models are rate-limited, and Hackl spends one request per tool call, so deep
Agent or Yolo turns can exhaust a daily quota. See
[`docs/setup-openrouter.md`](docs/setup-openrouter.md).

## Codex backend (optional)

Hackl can use [OpenAI Codex](https://developers.openai.com/codex/) instead of a
local or OpenRouter model. It does not bundle Codex: it drives your own installed
Codex CLI through its `app-server` interface, with your own Codex authentication.

Install the Codex CLI and authenticate, then:

```sh
hackl --codex "explain this repo"            # use Codex for the terminal CLI
hackl --codex --model <codex-model> "..."    # pick a Codex model
```

In VS Code, run `Hackl: Select Backend` and choose Codex (or `Hackl: Log in to
Codex`). Codex is wired into the CLI and the VS Code extension.

OpenAI [recommends API-key authentication for programmatic use](https://developers.openai.com/codex/auth);
`codex login` (your ChatGPT plan) also works for personal use. Your Codex usage
is governed by [OpenAI's terms](https://openai.com/policies/service-terms/) and
you are responsible for complying with them, including not exposing Codex
execution in untrusted or public environments.

## License

MIT. See [`LICENSE`](LICENSE). Third-party notices for the bundled dependencies
are in [`THIRD_PARTY.md`](THIRD_PARTY.md).
