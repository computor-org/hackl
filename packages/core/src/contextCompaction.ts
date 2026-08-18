import type { ChatBackend, ChatMessage } from "./chatClient";
import { splitReasoning } from "./reasoning";
import { estimateChatTokens } from "./tokenBudget";

export const DEFAULT_COMPACT_KEEP_TURNS = 8;
export const DEFAULT_COMPACT_SUMMARY_TOKENS = 4096;
export const DEFAULT_MAX_COMPACTIONS = 8;
export const COMPACTION_RATIO = 0.75;

const MIN_COMPACTION_CONTEXT = 8192;
const COMPACTION_RESERVE_CHARS = 12000;
const CHARS_PER_TOKEN = 3;
const MIN_TRANSCRIPT_CHARS = 10000;

const COMPACTION_PROMPT = [
  "Checkpoint older context for a coding agent.",
  "Preserve observed files, command and test evidence, findings with paths and lines, rejected hypotheses, changes, and remaining work.",
  "Separate facts from questions. Do not invent, conclude, or use tools.",
  "Return a concise factual checkpoint in plain text.",
].join(" ");

export interface ContextCompactionOptions {
  backend: ChatBackend;
  messages: ChatMessage[];
  maxContextTokens?: number;
  compactions: number;
  keepTurns?: number;
  summaryTokens?: number;
  maxCompactions?: number;
  signal?: AbortSignal;
}

export interface ContextCompactionResult {
  messages: ChatMessage[];
  compactions: number;
  compacted: boolean;
  fallback: boolean;
  beforeTokens: number;
  afterTokens: number;
  error?: string;
}

export function safeCompactionThreshold(contextTokens: number): number {
  if (!Number.isFinite(contextTokens) || contextTokens < MIN_COMPACTION_CONTEXT) {
    return 0;
  }
  return Math.floor(contextTokens * COMPACTION_RATIO);
}

export async function compactMessagesIfNeeded(
  options: ContextCompactionOptions,
): Promise<ContextCompactionResult> {
  const beforeTokens = estimateChatTokens(options.messages);
  const contextTokens = options.maxContextTokens ?? 0;
  const threshold = safeCompactionThreshold(contextTokens);
  const maxCompactions = options.maxCompactions ?? DEFAULT_MAX_COMPACTIONS;
  if (threshold === 0 || beforeTokens < threshold || options.compactions >= maxCompactions) {
    return unchanged(options.messages, options.compactions, beforeTokens);
  }

  const keepTurns = options.keepTurns ?? DEFAULT_COMPACT_KEEP_TURNS;
  const cut = tailStart(options.messages, keepTurns);
  if (cut <= 2) {
    return unchanged(options.messages, options.compactions, beforeTokens);
  }

  const summaryTokens = options.summaryTokens ?? DEFAULT_COMPACT_SUMMARY_TOKENS;
  const old = options.messages.slice(2, cut);
  const tail = options.messages.slice(cut);

  try {
    const summary = await requestSummary(options, old, contextTokens, summaryTokens);
    return successfulCompaction(options, old, tail, summary, threshold, keepTurns, beforeTokens);
  } catch (error) {
    return fallbackCompaction(options, keepTurns, beforeTokens, error);
  }
}

async function requestSummary(
  options: ContextCompactionOptions,
  old: ChatMessage[],
  contextTokens: number,
  summaryTokens: number,
): Promise<string> {
  const maxChars = Math.max(
    MIN_TRANSCRIPT_CHARS,
    (contextTokens - summaryTokens) * CHARS_PER_TOKEN - COMPACTION_RESERVE_CHARS,
  );
  const transcript = truncateHeadTail(JSON.stringify(old), maxChars);
  const messages: ChatMessage[] = [
    { role: "system", content: COMPACTION_PROMPT },
    { role: "user", content: `Task context remains available separately. Compact this older trajectory:\n\n${transcript}` },
  ];
  const response = await options.backend.complete(messages, {
    signal: options.signal,
    maxOutputTokens: summaryTokens,
    enableThinking: false,
  });
  return compactSummary(response.content);
}

function successfulCompaction(
  options: ContextCompactionOptions,
  old: ChatMessage[],
  tail: ChatMessage[],
  summary: string,
  threshold: number,
  keepTurns: number,
  beforeTokens: number,
): ContextCompactionResult {
  const checkpoint = checkpointText(summary, evidenceLedger(old, 12000));
  const compacted = withCheckpoint(options.messages, checkpoint, tail);
  const pruned = estimateChatTokens(compacted) >= threshold
    ? deterministicPrune(compacted, keepTurns, 12000)
    : compacted;
  return {
    messages: pruned,
    compactions: options.compactions + 1,
    compacted: true,
    fallback: false,
    beforeTokens,
    afterTokens: estimateChatTokens(pruned),
  };
}

function fallbackCompaction(
  options: ContextCompactionOptions,
  keepTurns: number,
  beforeTokens: number,
  error: unknown,
): ContextCompactionResult {
  const pruned = deterministicPrune(options.messages, keepTurns, 12000);
  return {
    messages: pruned,
    compactions: options.compactions + 1,
    compacted: pruned.length !== options.messages.length,
    fallback: true,
    beforeTokens,
    afterTokens: estimateChatTokens(pruned),
    error: error instanceof Error ? error.message : String(error),
  };
}

function unchanged(messages: ChatMessage[], compactions: number, tokens: number): ContextCompactionResult {
  return {
    messages,
    compactions,
    compacted: false,
    fallback: false,
    beforeTokens: tokens,
    afterTokens: tokens,
  };
}

function tailStart(messages: ChatMessage[], keepTurns: number): number {
  let seen = 0;
  for (let i = messages.length - 1; i >= 2; i -= 1) {
    if (messages[i].role !== "assistant") continue;
    seen += 1;
    if (seen >= Math.max(1, keepTurns)) return i;
  }
  return 2;
}

function withCheckpoint(messages: ChatMessage[], checkpoint: string, tail: ChatMessage[]): ChatMessage[] {
  return [
    ...messages.slice(0, 2),
    { role: "user", content: checkpoint },
    ...tail,
  ];
}

function deterministicPrune(messages: ChatMessage[], keepTurns: number, ledgerChars: number): ChatMessage[] {
  const cut = tailStart(messages, Math.max(1, Math.floor(Math.max(1, keepTurns) / 2)));
  if (cut <= 2) return messages;
  const ledger = evidenceLedger(messages.slice(2, cut), ledgerChars);
  const checkpoint = `DETERMINISTIC CONTEXT CHECKPOINT (full older events remain in this turn):\n${ledger}`;
  return withCheckpoint(messages, checkpoint, messages.slice(cut));
}

function checkpointText(summary: string, ledger: string): string {
  let checkpoint = "CONTEXT CHECKPOINT (older events were compacted):\n\n";
  checkpoint += summary || "No model-generated checkpoint was available.";
  if (ledger) checkpoint += `\n\nDETERMINISTIC EVIDENCE LEDGER:\n${ledger}`;
  return checkpoint;
}

function compactSummary(content: string): string {
  const split = splitReasoning(content);
  return (split.answer || content).trim();
}

function evidenceLedger(messages: ChatMessage[], maxChars: number): string {
  const lines: string[] = [];
  for (const message of messages) {
    const content = singleLine(message.content);
    if (!content) continue;
    const role = message.role === "assistant" ? "assistant" : "observation";
    lines.push(`- ${role}: ${content.slice(0, 700)}`);
    if (lines.join("\n").length >= maxChars) break;
  }
  return truncateHeadTail(lines.join("\n"), maxChars);
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateHeadTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const head = Math.floor(maxChars * 0.6);
  const tail = Math.max(0, maxChars - head - 40);
  return `${value.slice(0, head)}\n...[truncated]...\n${value.slice(-tail)}`;
}
