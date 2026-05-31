# Hackl Product Plan

Hackl is the general local-AI coding layer for the Computor product family and
a standalone local Copilot alternative for VS Code users who cannot or do not
want to enable GitHub Copilot.

## Product Position

Hackl owns the generic editor assistant workflow:

- local/BYO OpenAI-compatible endpoint discovery;
- coding chat with minimal editor metadata and on-demand tool context;
- optional FIM autocomplete against the chat endpoint or a dedicated endpoint;
- selection and file edit commands;
- agentic task execution with normal Git diffs and tests as the review layer;
- optional native VS Code AI integration when it helps without requiring
  Copilot.

Computor and Luna are integrations on top of this layer. Computor owns course
operations: tests, grading, and human messages. Luna owns the didactic tutor
behavior and assignment-aware prompts.

## Teaching Path

Hackl should expose the full AI-native programming ladder in a transparent way:

1. Read code and tests without AI.
2. Ask AI for explanations and debugging hints.
3. Use autocomplete for small, local completions.
4. Use edit mode and review normal file diffs.
5. Use work mode for multi-file edits.
6. Use agent mode with plans, tests, and commits.
7. Use CLI/background agents and review PRs.

The teaching mode slows down autonomy and makes context, diffs, and tests
visible. The work mode can keep the same machinery with fewer didactic
constraints.

## Computor Integration

Assignment chat should become the primary support surface:

- `@luna` routes to the assignment-aware AI tutor.
- `@tutor` escalates to a human tutor in the same assignment thread.
- The escalation carries assignment context plus file/test state and the
  transcript.
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
- context chips for editor/selection state plus assignment and model state;
- phase timing, reasoning visibility, and token/context budget feedback;
- `@luna` and `@tutor` routing in the same conversation model;
- normal editor files and Git diffs for future edit/agent review.

Keep an editor-tab chat command as a secondary surface for long sessions. Add a
native VS Code Chat Participant only as an optional bridge once the product
needs that integration; it must not be required for local-only use.

## Model Policy

Hackl defaults to one loaded model used for chat, edit, and agent workflows.
Users should not have to swap models for those modes. Inline autocomplete may
use a second endpoint because the best low-latency FIM model is not always the
best chat or agent model.

Preferred hardware tiers:

- Small RAM or weak GPU: Qwen3 4B-Instruct, or Gemma 3n E2B-it.
- Normal laptop or desktop: Qwen3 8B, or Gemma 3n E4B-it.
- Large local machine: Qwen3-Coder 30B-A3B, Qwen3 14B, or Gemma 3 12B/27B.

Preferred FIM tiers:

- Small RAM or weak GPU: Qwen2.5-Coder 1.5B or 3B Q4_K_M.
- Normal laptop or desktop: Qwen2.5-Coder 7B Q4_K_M.
- Large local machine: Qwen2.5-Coder 14B or Qwen3-Coder 30B-A3B Q4_K_M.
- Server-class local host: Qwen3-Coder-Next Q4_K_M, served as a separate FIM
  endpoint.

On a single 32 GB machine, pair the two: chat/agent on a 35B-A3B MoE (e.g.
Qwen3.6 35B-A3B at IQ4) and FIM on Qwen2.5-Coder 7B. They fit together because
the MoE chat KV is small and the FIM window is tiny. Prefer a small dense Coder
or a low-active-param MoE for FIM; a large dense Coder such as Codestral 22B
activates all weights per token and is too slow inline.

For Qwen3-Coder-Next, do not enable thinking mode. The model is documented as
non-thinking only and does not emit `<think></think>` blocks.

Inline FIM autocomplete is in scope as a bounded bridge between Ask and Edit.
It remains off by default and does not mutate files. The implementation should
prefer llama.cpp `/infill`, fall back to `/completion` with FIM markers, and
support a dedicated endpoint/model alias for routed local deployments.

## Sequence

1. Chat foundation over local OpenAI-compatible endpoints.
2. Right-side Hackl chat view with Markdown and local LaTeX math rendering.
3. Minimal default prompt: path/cursor/selection metadata only, with
   Qwen-friendly `read_file` tools for on-demand context.
4. Cache-aware provider adapters for local backends, starting with stable
   prompt prefixes and later backend-specific prompt-cache or slot controls
   where the server exposes them.
5. Assignment-aware Luna prompt mode and Computor context bridge.
6. Inline FIM autocomplete with a dedicated endpoint option.
7. Selection/file edit commands that produce normal workspace edits.
8. Agent mode with approved structured commands, test/diff output, and optional
   commit.
9. `@tutor` escalation into Computor human support threads.
10. Optional native VS Code chat participant or language model provider.

## Research Notes

May 2026 evidence points toward more autonomous coding workflows: chat, edit
mode, agent mode, CLI/background agents, and PR review. For teaching,
Hackl should expose the path rather than hide it. The goal is programming
literacy plus AI-native programming, not a black-box replacement for learning.
