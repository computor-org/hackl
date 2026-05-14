import type { ChatMessage } from "./chatClient";
import { ASK_TOOL_INSTRUCTIONS, EDIT_TOOL_INSTRUCTIONS, WORK_TOOL_INSTRUCTIONS, AGENT_TOOL_INSTRUCTIONS } from "./tools";

export type ConversationMessage = Pick<ChatMessage, "role" | "content">;
export type PromptMode = "ask" | "edit" | "work" | "agent";

const ASK_SYSTEM_PROMPT = [
  "Hackl. Local code helper. Terse. No edits. No long think.",
  "If selection shown, 'this/that/it' = the selection. Do not read_file unless needed.",
  ASK_TOOL_INSTRUCTIONS,
].join("\n");

const EDIT_SYSTEM_PROMPT = [
  "Hackl. Local code editor. Terse. Make requested edits. No long think.",
  "If selection shown, 'this/that/it' = the selection. Read files before editing when needed.",
  EDIT_TOOL_INSTRUCTIONS,
].join("\n");

const WORK_SYSTEM_PROMPT = [
  "Hackl. Local coding worker. Terse. Inspect, edit, and stop. No long think.",
  "Use Work for multi-step file changes. Do not run shell commands or claim tests ran.",
  "If selection shown, 'this/that/it' = the selection.",
  WORK_TOOL_INSTRUCTIONS,
].join("\n");

const AGENT_SYSTEM_PROMPT = [
  "Hackl. Local coding agent. Terse. Inspect, edit, verify, and stop. No long think.",
  "Use Agent for multi-step file changes plus safe command checks.",
  "If selection shown, 'this/that/it' = the selection.",
  AGENT_TOOL_INSTRUCTIONS,
].join("\n");

const MAX_HISTORY_MESSAGES = 8;

export function buildHacklMessages(
  prompt: string,
  contextText: string,
  history: ConversationMessage[] = [],
  mode: PromptMode = "ask",
): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt(mode) },
    ...trimHistory(history),
    {
      role: "user",
      content: `${contextText || "[no editor context]"}\n\n${prompt}`,
    },
  ];
}

function systemPrompt(mode: PromptMode): string {
  if (mode === "agent") {
    return AGENT_SYSTEM_PROMPT;
  }
  if (mode === "work") {
    return WORK_SYSTEM_PROMPT;
  }
  return mode === "edit" ? EDIT_SYSTEM_PROMPT : ASK_SYSTEM_PROMPT;
}

function trimHistory(history: ConversationMessage[]): ChatMessage[] {
  return history
    .filter((message): message is ChatMessage => isChatRole(message.role) && message.content.trim() !== "")
    .slice(-MAX_HISTORY_MESSAGES);
}

function isChatRole(role: string): role is ChatMessage["role"] {
  return role === "user" || role === "assistant" || role === "system";
}
