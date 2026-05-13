import type { ConversationMessage } from "./prompt";

export interface ChatIncomingMessage {
  type: string;
  prompt?: string;
}

export type ChatOutgoingMessage =
  | { type: "answer" | "error" | "status"; text: string }
  | { type: "cleared" }
  | { type: "history"; entries: ConversationMessage[] };

export type ChatPost = (message: ChatOutgoingMessage) => Thenable<unknown> | Promise<unknown>;

export class ChatSession {
  private readonly history: ConversationMessage[] = [];

  constructor(private readonly onPrompt: (prompt: string, history: ConversationMessage[]) => Promise<string>) {}

  async handle(message: ChatIncomingMessage, post: ChatPost): Promise<void> {
    if (message.type === "ready") {
      await post({ type: "history", entries: [...this.history] });
      return;
    }
    if (message.type === "clear") {
      this.history.length = 0;
      await post({ type: "cleared" });
      return;
    }
    if (message.type === "prompt") {
      await this.handlePrompt(message.prompt, post);
    }
  }

  private async handlePrompt(rawPrompt: string | undefined, post: ChatPost): Promise<void> {
    const prompt = rawPrompt?.trim();
    if (!prompt) {
      return;
    }

    await post({ type: "status", text: "Thinking..." });
    const previousHistory = [...this.history];
    this.history.push({ role: "user", content: prompt });
    try {
      const answer = await this.onPrompt(prompt, previousHistory);
      this.history.push({ role: "assistant", content: answer });
      await post({ type: "answer", text: answer });
    } catch (error) {
      this.history.pop();
      const text = error instanceof Error ? error.message : String(error);
      await post({ type: "error", text });
    }
  }
}
