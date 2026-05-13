import type { ChatMessage } from "./chatClient";

export type ConversationMessage = Pick<ChatMessage, "role" | "content">;

const SYSTEM_PROMPT = [
  "You are Hackl, a local-first coding assistant.",
  "Answer using the supplied editor context.",
  "Do not claim to edit files. Suggest changes in prose or code blocks only.",
  "Assume Git is the review and history layer.",
].join("\n");

const MAX_HISTORY_MESSAGES = 8;

export function buildHacklMessages(
  prompt: string,
  contextText: string,
  history: ConversationMessage[] = [],
): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...trimHistory(history),
    {
      role: "user",
      content: `Editor context:\n\n${contextText || "[No open editor context]"}\n\nUser request:\n\n${prompt}`,
    },
  ];
}

function trimHistory(history: ConversationMessage[]): ChatMessage[] {
  return history
    .filter((message): message is ChatMessage => isChatRole(message.role) && message.content.trim() !== "")
    .slice(-MAX_HISTORY_MESSAGES);
}

function isChatRole(role: string): role is ChatMessage["role"] {
  return role === "user" || role === "assistant" || role === "system";
}
