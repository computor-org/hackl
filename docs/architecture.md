# Hackl Foundation

Hackl is a local-first VS Code chat extension over OpenAI-compatible backends.
The durable foundation is independent of the current chat surface:

- `ChatBackend` owns the OpenAI-compatible `/chat/completions` contract.
- `resolveChatTarget` owns endpoint discovery and loaded-model resolution.
- `buildHacklMessages` owns prompt assembly from editor context and transcript.
- `ChatPanel` is the current UI shell only.

Hackl's broader product role is the missing local Copilot layer: a policy-safe
VS Code assistant that can grow from chat into autocomplete, edit mode, and
agent mode without requiring the GitHub Copilot extension or a hosted service.

## Backend Boundary

Hackl supports only OpenAI-compatible local or self-hosted endpoints:

- llama.cpp: `http://localhost:8080/v1`
- LM Studio: `http://localhost:1234/v1`
- configured compatible endpoint, including slopgate

Users configure `hackl.endpoint` only. Hackl does not expose model selection.
It probes `/v1/models` and uses the loaded model id. If a multi-model gateway
requires an alias, Hackl uses the first alias advertised by the gateway error.

No hosted-provider adapters, API presets, file mutation, terminal execution, or
custom history layer belong in this phase.

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

Hackl should prefer one loaded local model. The user should not have to swap
models for chat, autocomplete, edit, and agent workflows. For the first
autocomplete implementation, assume the server is serving Qwen 3.5 or Qwen3.6
and use only the Qwen FIM format. Do not add generic FIM-template support yet.

Initial local tiers:

- Small RAM or weak GPU: Qwen3.5 4B, or Gemma 4 E2B/E4B for chat/edit only.
- Normal laptop or desktop: Qwen3.5 9B, or Gemma 4 E4B for chat/edit only.
- Large local machine: Qwen3.6-35B-A3B, or Gemma 4 26B A4B / 31B for
  chat/edit/agent work only.

For Qwen3.6-35B-A3B autocomplete, first test the Qwen FIM template:

```text
<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>
```

Use short completion budgets, low temperature, stop tokens for Qwen FIM/chat
markers, and non-thinking mode where the server supports it. Do not recommend
swapping to Qwen-Coder as the fallback; it is weaker for the broader Hackl
workflow. If Qwen3.6-35B-A3B cannot provide acceptable autocomplete, suppress
autocomplete before making users leave the primary model.

Do not enable FIM autocomplete for Gemma 4. Current official Gemma 4
documentation covers chat formatting, coding/agentic capability, and MTP, but
not fill-in-the-middle support. If the loaded model id is Gemma, Hackl should
keep chat/edit/agent features and suppress autocomplete until official FIM
support or a tested template exists.

## UI Direction

The current webview is intentionally small: transcript, clear, busy state,
Enter-to-send, and editor context on every turn. This keeps the user experience
closer to modern assistant chat while avoiding premature commitments to edit
mode, tools, native chat participants, or a merged tutor inbox.

Native VS Code chat remains a candidate once the product needs deeper VS Code
chat affordances. Until then, the webview is easier to package, smoke test, and
keep local-first.

The current VS Code docs make the tradeoff explicit: chat participants are for
domain-specific assistants that own prompt handling inside the VS Code chat
experience, while webviews are fully custom UI and should be used sparingly.
For Hackl this means:

- Keep the backend and prompt contracts reusable now.
- Keep the custom webview while Hackl is a standalone local-first chat product.
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
