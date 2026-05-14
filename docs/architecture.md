# Hackl Foundation

Hackl is a local-first VS Code chat extension over OpenAI-compatible backends.
The durable foundation is independent of the current chat surface:

- `ChatBackend` owns the OpenAI-compatible `/chat/completions` contract.
- `resolveChatTarget` owns endpoint discovery and loaded-model resolution.
- `buildHacklMessages` owns prompt assembly from editor metadata, basket
  targets, annotation options, and transcript.
- `completeWithTools` owns the Qwen-friendly tool loop.
- `ChatViewProvider` is the current UI shell only.

Hackl's broader product role is the missing local Copilot layer: a policy-safe
VS Code assistant that grows from chat into edit mode and agent mode without
requiring the GitHub Copilot extension or a hosted service. Inline FIM
autocomplete was explored and intentionally dropped — see "Model Policy".

## Backend Boundary

Hackl supports only OpenAI-compatible local or self-hosted endpoints:

- llama.cpp: `http://localhost:8080/v1`
- LM Studio: `http://localhost:1234/v1`
- configured compatible endpoint, including slopgate

Users configure `hackl.endpoint` only. Hackl does not expose model selection.
It probes `/v1/models` and uses the loaded model id. If a multi-model gateway
requires an alias, Hackl uses the first alias advertised by the gateway error.

No hosted-provider adapters, API presets, custom history layer, or auto-approved
command mode belong in this phase.

## Basket, Context, And Tools

Hackl now keeps the default prompt small. A normal chat turn includes:

- active/open file paths;
- active cursor line and column;
- selection range and selected text capped at 4000 characters;
- explicit basket targets when present;
- recent chat transcript;
- a compact `HACKL_TOOL` contract.

It does not include open-file bodies by default. If the model needs code, it
must request:

```text
HACKL_TOOL {"name":"read_file","path":"src/file.ts","start_line":1,"end_line":120}
```

Hackl has four modes:

- Ask: bounded `read_file` only.
- Edit: `read_file` plus exact `replace_text` edits.
- Work: search, read, and edit without shell commands.
- Agent: search, read, edit, and approved structured commands.

Modes control capability only. Annotation generation is a separate request
option. When enabled, Hackl asks for a `hackl-annotations` JSON block, parses it
into VS Code comment threads, and persists the finished Hackl session under
`.hackl/sessions/` when configured.

Current basket target kinds are:

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

## Model Policy

Hackl prefers one loaded local model used for chat, edit, and agent workflows.
The user should not have to swap models.

Initial local tiers:

- Small RAM or weak GPU: Qwen3.5 4B, or Gemma 4 E2B/E4B.
- Normal laptop or desktop: Qwen3.5 9B, or Gemma 4 E4B.
- Large local machine: Qwen3.6-35B-A3B, or Gemma 4 26B A4B / 31B.

Inline FIM autocomplete is intentionally out of scope. It was prototyped
(v0.0.13 – v0.0.15) and removed: at the latency a single locally-loaded
chat-class model can deliver, the UX did not beat the chat/edit workflow that
is Hackl's core, and maintaining a parallel FIM client, dialect detector, and
prompt template added surface area without proportionate value. The chat/edit
loop replaces autocomplete for Hackl's use case.

## UI Direction

The default chat UI is a Hackl-owned `WebviewView` contributed to a Hackl view
container. It is designed for the Secondary Sidebar: the same right-side work
area users commonly use for Copilot, Codex, Claude, and similar assistants.
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
- compact basket controls;
- annotation toggle and discard-last-annotations control;
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

## Gates

Required local gates:

```bash
npm test
npm run test:coverage
npm run test:extension
npm run package:vsix
npm run smoke:openai -- http://10.77.0.20:8080/v1
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
