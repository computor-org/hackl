import type { ChatMessage } from "./chatClient";
import { TOOL_INSTRUCTIONS } from "./tools";

export type ConversationMessage = Pick<ChatMessage, "role" | "content">;

const SYSTEM_PROMPT = [
  "Hackl. Local code helper. Terse. No edits. No long think.",
  "If selection shown, 'this/that/it' = the selection. Do not read_file unless needed.",
  TOOL_INSTRUCTIONS,
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
      content: `${contextText || "[no editor context]"}\n\n${prompt}`,
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
