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
2. Assignment-aware Luna prompt mode and Computor context bridge.
3. Inline autocomplete using VS Code `InlineCompletionItemProvider`, Qwen FIM
   format only: try Qwen3.5/Qwen3.6, keep Gemma off, never swap to Qwen-Coder.
4. Selection/file edit commands that produce normal workspace edits.
5. Agent mode with plan, tests, diff, and optional commit.
6. `@tutor` escalation into Computor human support threads.
7. Optional native VS Code chat participant or language model provider.

## Research Notes

May 2026 evidence points toward more autonomous coding workflows: autocomplete,
chat, edit mode, agent mode, CLI/background agents, and PR review. For teaching,
Hackl should expose the path rather than hide it. The goal is programming
literacy plus AI-native programming, not a black-box replacement for learning.
