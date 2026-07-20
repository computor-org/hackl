import type { ChatMessage } from "./chatClient";

const CHARS_PER_TOKEN = 4;

export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export function estimateChatTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => {
    return total + estimateTextTokens(message.role) + estimateTextTokens(message.content) + 4;
  }, 0);
}

export function formatTokenBudget(estimatedTokens: number, maxContextTokens: number): string {
  const percent = Math.round((estimatedTokens / maxContextTokens) * 100);
  return `~${estimatedTokens.toLocaleString()} / ${maxContextTokens.toLocaleString()} tokens (${percent}%)`;
}
