# Hackl Foundation

Hackl is a local-first VS Code chat extension over OpenAI-compatible backends.
The durable foundation is independent of the current chat surface:

- `ChatBackend` owns the OpenAI-compatible `/chat/completions` contract.
- `resolveChatTarget` owns endpoint discovery and loaded-model resolution.
- `buildHacklMessages` owns prompt assembly from editor metadata, context
  targets, annotation options, and transcript.
- `completeWithTools` owns the Qwen-friendly tool loop.
- `ChatViewProvider` is the current UI shell only.

Hackl's broader product role is the missing local Copilot layer: a policy-safe
VS Code assistant that grows from chat into autocomplete, edit mode, and agent
mode without requiring the GitHub Copilot extension or a hosted service.

Hackl is designed as a production tool with a visible learning ladder: users can
work directly, but the same Ask -> Autocomplete -> Edit -> Work -> Agent ->
Review progression can be surfaced by Computor for teaching.

## Backend Boundary

Hackl supports only OpenAI-compatible local or self-hosted endpoints:

- llama.cpp: `http://localhost:8080/v1`
- LM Studio: `http://localhost:1234/v1`
- configured compatible endpoint, including a routed multi-model gateway

Users configure `hackl.endpoint` for the non-autocomplete modes. Hackl
also exposes `hackl.autocomplete.endpoint` and `hackl.autocomplete.model` for a
dedicated FIM endpoint. If the autocomplete endpoint is empty, Hackl reuses the
configured or auto-discovered chat endpoint and carries `hackl.model` into the
FIM request. Known Qwen, CodeGemma, and CodeLlama model names determine their
FIM dialect directly; unknown models fall back to a `/tokenize` probe.
Bare server URLs are normalized to their OpenAI-compatible `/v1` base, while
an explicitly supplied path such as OpenRouter's `/api/v1` is preserved.

The VS Code frontend asks once before chat sends context to a configured
non-loopback endpoint. Approval is stored per exact endpoint in extension
global state and can be revoked with `Hackl: Forget Trusted Remote Endpoints`.
The extension listens for endpoint and model configuration changes, invalidates
connection caches, synchronizes the stored backend selection, and republishes
chat/status state. The settings editor and chat dropdown therefore operate on
the same `hackl.model` value without requiring a manual reconnect.

Local servers are keyless. For an authenticated gateway (e.g. OpenRouter), Hackl
sends a Bearer token on each chat request. The CLI reads it from `HACKL_API_KEY`,
the `apiKey` config field, or `--api-key`; the VS Code extension stores it in
SecretStorage via `Hackl: Set API Key`, never in settings.json.

No provider-specific adapters, API presets, or custom history layer belong in
this phase. A generic Bearer token for OpenAI-compatible gateways is supported
(see above); it is not a per-provider integration.

## Managed local engine

`@hackl/engine` (in `@hackl/core`) is one manager shared by the CLI, the VS Code
extension host, and the server. It probes hardware (`probeSystem`), recommends a
model (`recommendModel`, which prefers the 35B-A3B MoE over the dense 27B and
Qwen 9B over Gemma 12B at ~16 GB), resolves or downloads a pinned, sha256-verified
llama.cpp binary, pulls a GGUF into the shared cache, and supervises the process.

It binds `127.0.0.1` by default and composes the launch flags (context,
n-cpu-moe, KV quant, flash-attn, sampler preset, MTP and mmproj) from the probe.
A versioned per-user socket or Windows named-pipe coordinator atomically elects
one owner. `hackl serve` hosts it in the foreground; CLI, VS Code, and desktop
clients use heartbeating leases. An automatic host stops after its last lease,
while a foreground host stops only on its terminal signal. Model and launch
state never change under a live owner.

An already-running server is adopted read-only and external servers are never
killed. Durable settings live as an `engine` block in
`~/.config/hackl/config.json` (overrides only; defaults recomputed each launch).
The model cache (`~/.cache/llama.cpp`) and install dir (`~/.local/llama.cpp`)
match the conventions of an existing manual/slopcode-infra install, so they
interoperate. No OS service, login task, or system tray is installed.

## Context And Tools

Hackl now keeps the default prompt small. A normal chat turn includes:

- active/open file paths;
- active cursor line and column;
- selection range and selected text capped at 4000 characters;
- explicit context targets when present;
- recent chat transcript;
- a compact `HACKL_TOOL` contract.

It does not include open-file bodies by default. If the model needs code, it
must request:

```text
HACKL_TOOL {"name":"read_file","path":"src/file.ts","start_line":1,"end_line":120}
```

Hackl has six capability levels:

- Ask: bounded `read_file` only.
- Autocomplete: inline FIM suggestions only.
- Edit: `read_file` plus exact `replace_text` edits.
- Work: search, read, and edit without shell commands.
- Agent: workspace access plus approved structured commands.
- Yolo: workspace access plus any shell command, with the command policy and per-command approval turned off. The user owns the risk.

Modes control capability only. `/review` asks for a `hackl-annotations` JSON
block, parses it into VS Code comment threads, and persists the finished Hackl
session under VS Code extension storage when configured.

Current context target kinds are:

- `source-range`
- `staged-changes`
- `commit`
- `markdown-section`

Tool paths are constrained to real workspace paths after symlink resolution.
File reads and searches skip binary files and files over the tool size limit.
Tool results are returned as `HACKL_TOOL_RESULT` user messages for the current
turn and are not stored in the durable transcript. This keeps follow-up prompts
small and makes cache reuse more plausible because the stable prompt prefix
changes less.

Before each model turn, Hackl uses the endpoint's effective context when the
server reports one; a local context setting is only a fallback for servers that
do not expose it. The tool loop compacts at 75% of that effective window. It
asks the same backend for a tool-free factual checkpoint capped at 4096 output
tokens, keeps the latest eight assistant turns, and adds a deterministic
evidence ledger. If the checkpoint request fails, deterministic pruning keeps
the agent moving without sending an oversized prompt.

Portable KV-cache or slot-affinity control is not part of the OpenAI-compatible
contract. The near-term cache strategy is therefore:

- stable system prompt;
- small metadata context by default;
- no automatic file-body replay across turns;
- backend-specific options only behind provider adapters, for example
  llama.cpp prompt-cache or slot controls where available.

## Computor And Luna

Computor's current message views are course/thread scoped and useful for human
communication, but they are not the right generic coding-chat foundation. Hackl
keeps the AI backend, prompt, and context layers separate so Computor or Luna
can later reuse them without inheriting Hackl's webview.

Future integration choices stay open:

- A combined human and AI tutor conversation can route Computor messages into
  the same backend boundary.
- Assignment chat can route `@luna` to the local/BYO AI tutor and `@tutor` to
  the human Computor tutor thread with transcript and assignment context.
- A separate AI assistant panel can stay beside Computor's human message UI.
- VS Code native chat can replace the webview if it fits the desired UX and
  extension API stability.

The invariant is that Computor/Luna integration should depend on backend and
prompt contracts, not on a specific Hackl chat surface.

## Learning-Through-Use Pattern

Hackl should remain a capable production coding assistant. It must not become a
toy tutor or a separate training sandbox.

The product pattern is closer to Syntorial: a tool that teaches a domain by
making the learner use a real instrument. Syntorial teaches synthesizer sound
design through a working synthesizer and staged exercises; Hackl should teach
AI-assisted coding through a working coding assistant and staged capability
levels.

For Hackl, the stages are:

- Ask: understand code before changing it.
- Autocomplete: accept or reject small local completions.
- Edit: make bounded, inspectable changes.
- Work: coordinate multi-file changes.
- Agent: delegate bounded checks and tool use.
- Review: inspect staged changes, annotations, and commit intent.

Computor/Luna can later turn these stages into curriculum, assignments,
rubrics, and progress tracking. Hackl must expose the underlying workflow events:
selected context, mode used, tool requests, edits, checks, annotations, replies,
review state, and commit/staged context.

The invariant is that Hackl teaches the workflow by being the workflow. Expert
users can move directly to Work or Agent mode, while juniors can be guided
through the same stages explicitly.

## Model Policy

Hackl uses one loaded Qwen model for every mode, autocomplete included. The Qwen
line ships the infill tokens, so the chat server also drives FIM through
`/infill`; the user does not swap models. A second endpoint stays optional for
hosts that want lower keystroke latency from a smaller FIM model.

Local tiers, one model each (Gemma 4 is a chat-only alternative; it has no
infill tokens, so it drives chat, edit, and agent but not autocomplete):

- Small RAM or weak GPU: Qwen3.5 4B, or Gemma 4 E2B.
- Normal laptop or desktop: Qwen3.5 9B, or Gemma 4 E4B.
- Large local machine (24-32 GB): Qwen3.8 27B, or Gemma 4 26B-A4B.

Each runs Qwen's "thinking + precise coding" sampler (temp 0.6, top-p 0.95,
top-k 20, min-p 0) with reasoning capped at 4096 tokens. The cap stops a thinking
model from looping through the whole turn in agent mode; on llama.cpp it is the
`--reasoning-budget` flag, otherwise Hackl sends it per request from
`hackl.reasoningBudget`.

Autocomplete is deliberately narrow: it calls llama.cpp `/infill` first,
falls back to `/completion` with FIM markers, detects Qwen, CodeGemma, and
CodeLlama marker dialects, and never mutates files. `/infill` skips the chat
template, so FIM never enters a reasoning phase even on a thinking model.

## UI Direction

The default chat UI is a Hackl-owned `WebviewView` contributed to a Hackl view
container. It is designed for the Secondary Sidebar: the same right-side work
area users commonly use for Copilot-style assistants.
VS Code does not let extensions contribute directly to the Secondary Sidebar by
default, so the view must work as a normal contributed view and remain movable
by the user.

The renderer should stay small and local:

- no external network resources;
- VS Code theme variables and codicon-compatible layout;
- compact TUI-like transcript rather than a web app look;
- Markdown rendering for assistant responses;
- local LaTeX math rendering for physics and mathematics explanations;
- prompt preprocessing/model phase status;
- gray reasoning display from `<think>` or reasoning deltas;
- estimated input-token/context-window meter;
- clear busy/error states, Enter-to-send, and transcript clearing;
- compact context controls;
- discard-last-annotations control;
- future room for `@luna` and `@tutor`.

Native VS Code chat remains a candidate once the product needs deeper built-in
chat affordances. It is an optional bridge, not the default UI, because Hackl
must keep working when GitHub Copilot and hosted AI surfaces are disabled.

The current VS Code docs make the tradeoff explicit: chat participants are for
domain-specific assistants that own prompt handling inside the VS Code chat
experience, while webviews are fully custom UI and should be used sparingly.
For Hackl this means:

- Keep the backend and prompt contracts reusable now.
- Keep the custom webview view while Hackl is a standalone local-first chat
  product.
- Move to a native chat participant if Hackl should live inside VS Code Chat or
  share UI conventions with Copilot-style participants.
- Consider the Language Model Chat Provider API only if Hackl should expose the
  local backend as a VS Code language model for other extensions, not just use
  it internally.

## Release channels

Hackl uses even minor versions for stable releases and odd minor versions for
pre-releases. Versions stay in `major.minor.patch` form because the VS Code
Marketplace does not accept SemVer suffixes:

- `0.3.x`: GitHub and Marketplace pre-release.
- `0.4.x`: stable.

`scripts/release-channel.mjs` validates the package version, GitHub tag, and
GitHub pre-release flag. `npm run package:vsix` automatically adds the
Marketplace pre-release marker for odd minor versions. After the GitHub release
artifacts pass, `npm run publish:marketplace` publishes the same VSIX using
`VSCE_PAT` when set or the current Microsoft Entra credential otherwise.

## Gates

Required local gates:

```bash
npm test
npm run test:coverage
npm run test:extension
npm run package:vsix
npm run smoke:openai -- http://127.0.0.1:8080/v1
```

CI runs coverage, extension-host smoke, and VSIX packaging. Release builds run
the same checks and upload the generated VSIX to the GitHub release.

## References

- VS Code Chat Participant API:
  `https://code.visualstudio.com/api/extension-guides/chat`
- VS Code Webview API:
  `https://code.visualstudio.com/api/extension-guides/webview`
- VS Code view UX guidelines:
  `https://code.visualstudio.com/api/ux-guidelines/views`
- VS Code Language Model Chat Provider API:
  `https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider`
- VS Code extension publishing and `vsce`:
  `https://code.visualstudio.com/api/working-with-extensions/publishing-extension`
- Syntorial:
  `https://en.wikipedia.org/wiki/Syntorial`
