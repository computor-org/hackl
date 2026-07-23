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
- A generic API key (Bearer token) for OpenAI-compatible gateways such as
  OpenRouter is supported but optional; local keyless use stays the default and
  the brand story. CLI reads `HACKL_API_KEY` / `apiKey` config / `--api-key`;
  VS Code uses SecretStorage (`Hackl: Set API Key`), never settings.json.

Workflow:
- Prefer agentic instruction and explicit user direction.
- Use Git as the history and review layer; edits are normal file changes
  reviewable via `git diff`.

## Scope

Hackl is a local-first AI coding agent with a shared core and several frontends:

- `@hackl/core`: agent loop, tools, backends, MCP client, and session.
- `@hackl/cli` (`hackl`): terminal one-shot, REPL, and NDJSON.
- `@hackl/server` + `@hackl/webui`: the internal localhost server and shared
  browser UI used by `hackl serve` and desktop.
- `@hackl/desktop`: an Electron shell around the server and the shared UI.
- VS Code extension: in-editor chat, Git-anchored annotations, inline autocomplete.

Capability modes gate the agent: ask, edit, work, agent, yolo. Backends: local
OpenAI-compatible servers (default), OpenAI-compatible gateways via an optional
API key (e.g. OpenRouter), and the Codex app-server. MCP tools work across the
frontends. Scope is open; weigh new directions on their merits.

Managed local engine: `@hackl/engine` (in core) probes hardware, recommends a
model, installs/adopts and supervises llama.cpp. `hackl serve [model]` is the
explicit foreground owner; ordinary CLI, VS Code, and desktop clients share one
lease-based automatic session that exits after the last client. The first
starter owns the model and launch state. No installed service or tray process
is used. VS Code's global `hackl.engine.enabled` setting persists independently
of autocomplete and never stops a manual or external server.
It binds `127.0.0.1` by default; the managed llama.cpp binary is a pinned,
sha256-verified download (never at npm install). Defaults derive from the
slopcode-infra launch profile; the public model catalog is a curated subset.
Model guidance: prefer the 35B-A3B MoE over the dense 27B (faster decode), and
Qwen 9B over Gemma 12B at ~16 GB. Engine config: `~/.config/hackl/config.json`
(`engine` block, overrides only); runtime state: `~/.local/state/hackl/`; model
cache `~/.cache/llama.cpp`; binary `~/.local/llama.cpp` or the managed cache.
An already-running server is adopted read-only and never stopped by hackl.

## llama.vscode Provenance

Hackl is not a fork of `ggml-org/llama.vscode`.

`llama.vscode` is MIT licensed and useful prior art for VS Code inline
completion, `/infill`, OpenAI-compatible endpoints, env/model management, and
webview agent UX. Hackl reimplements its own surface and does not copy code from
it.

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

After any change to `@hackl/cli` or any release, rebuild and reinstall the global
CLI so the `hackl` command on PATH matches the source:

```bash
npm run build:cli
install -m 755 packages/cli/dist/index.js "$(command -v hackl)"
```

Updating the VS Code extension (`code --install-extension`) does not update the
CLI; do both.

## Git Rules

- Stage paths explicitly.
- Never `git add .` or `git add -A`.
- Keep commits specific and human-readable.
- Public MIT-licensed repository. Keep secrets out of tracked files.
