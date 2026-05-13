# Hackl Product Plan

Hackl is the general local-AI coding layer for the Computor product family and
a standalone local Copilot alternative for VS Code users who cannot or do not
want to enable GitHub Copilot.

## Product Position

Hackl owns the generic editor assistant workflow:

- local/BYO OpenAI-compatible endpoint discovery;
- coding chat with editor context;
- inline autocomplete;
- selection and file edit commands;
- agentic task execution with normal Git diffs and tests as the review layer;
- optional native VS Code AI integration when it helps without requiring
  Copilot.

Computor and Luna are integrations on top of this layer. Computor owns courses,
assignments, submissions, grading, tests, and human messages. Luna owns the
didactic tutor behavior and assignment-aware prompts.

## Teaching Path

Hackl should expose the full AI-native programming ladder in a transparent way:

1. Read code and tests without AI.
2. Ask AI for explanations and debugging hints.
3. Use autocomplete and inspect each suggestion.
4. Use chat to reason about code and errors.
5. Use edit mode and review normal file diffs.
6. Use agent mode with plans, tests, and commits.
7. Use CLI/background agents and review PRs.

The teaching mode slows down autonomy and makes context, diffs, and tests
visible. The work mode can keep the same machinery with fewer didactic
constraints.

## Computor Integration

Assignment chat should become the primary support surface:

- `@luna` routes to the assignment-aware AI tutor.
- `@tutor` escalates to a human tutor in the same assignment thread.
- The escalation includes assignment, file, test, and transcript context.
- Human tutor replies return to the same thread.

This replaces clunky asynchronous assignment messages with one conversation
that can contain AI and human support while preserving provenance.

Public Computor deployments should not have to host model inference. Students
or institutions bring their own API key or local endpoint. Hackl is the local
endpoint bridge for that policy-safe path.

## Chat UI

The default Hackl chat surface should be a VS Code view that is designed to
live in the Secondary Sidebar, next to the editor like Copilot, Codex, Claude,
and other current coding assistants. VS Code extensions cannot force a view
directly into the Secondary Sidebar by default, so Hackl should contribute a
normal view container and make it easy to focus. Users can move that view to the
right sidebar as part of their workspace layout.

The chat UI should be Hackl-owned rather than Copilot-owned:

- local-first and usable when GitHub Copilot is disabled;
- compact TUI-like transcript, using VS Code colors and fonts;
- Markdown rendering for explanations and code blocks;
- local LaTeX math rendering for physics and mathematics teaching;
- context chips for the current editor, selection, assignment, and model state;
- `@luna` and `@tutor` routing in the same conversation model;
- normal editor files and Git diffs for future edit/agent review.

Keep an editor-tab chat command as a secondary surface for long sessions. Add a
native VS Code Chat Participant only as an optional bridge once the product
needs that integration; it must not be required for local-only use.

## Model Policy

Hackl defaults to one loaded model. For the first autocomplete implementation,
assume the server is serving Qwen 3.5 or Qwen3.6 and use only the Qwen FIM
format. Do not add a generic FIM-template matrix yet, and do not ask users to
swap away from the primary coding model for autocomplete.

Preferred hardware tiers:

- Small RAM or weak GPU: Qwen3.5 4B, or Gemma 4 E2B/E4B for chat/edit only.
- Normal laptop or desktop: Qwen3.5 9B, or Gemma 4 E4B for chat/edit only.
- Large local machine: Qwen3.6-35B-A3B, or Gemma 4 26B A4B / 31B for
  chat/edit/agent work only.

The large Qwen target is `Qwen3.6-35B-A3B`, not Qwen3-30B. It should be tested
for autocomplete with the Qwen FIM template:

```text
<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>
```

Use short autocomplete budgets, low temperature, and non-thinking mode. For
Qwen3.6 via OpenAI-compatible servers, pass the equivalent of:

```json
{
  "chat_template_kwargs": {
    "enable_thinking": false
  }
}
```

Gemma 4 should not get FIM autocomplete. Current official Gemma 4 docs describe
chat formatting, coding/agentic capability, and MTP speculative decoding, but
do not document FIM tokens or fill-in-the-middle training. If the loaded model
id looks like Gemma, Hackl should disable autocomplete and keep chat/edit/agent
features available.

Do not recommend Qwen-Coder as an automatic fallback. It has explicit FIM
support, but it is weaker for the broader Hackl workload than Qwen3.6-35B-A3B.
If Qwen3.6 cannot provide acceptable autocomplete, disable autocomplete before
making users swap models.

## Roadmap

1. Chat foundation over local OpenAI-compatible endpoints.
2. Right-side Hackl chat view with Markdown and local LaTeX math rendering.
3. Assignment-aware Luna prompt mode and Computor context bridge.
4. Inline autocomplete using VS Code `InlineCompletionItemProvider`, Qwen FIM
   format only: try Qwen3.5/Qwen3.6, keep Gemma off, never swap to Qwen-Coder.
5. Selection/file edit commands that produce normal workspace edits.
6. Agent mode with plan, tests, diff, and optional commit.
7. `@tutor` escalation into Computor human support threads.
8. Optional native VS Code chat participant or language model provider.

## Research Notes

May 2026 evidence points toward more autonomous coding workflows: autocomplete,
chat, edit mode, agent mode, CLI/background agents, and PR review. For teaching,
Hackl should expose the path rather than hide it. The goal is programming
literacy plus AI-native programming, not a black-box replacement for learning.
