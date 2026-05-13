import type { ConversationMessage } from "./prompt";

export interface ChatIncomingMessage {
  type: string;
  prompt?: string;
  value?: unknown;
}

export type ChatOutgoingMessage =
  | { type: "answer"; text: string; reasoning?: string }
  | { type: "assistantDelta"; channel: "answer" | "reasoning"; text: string }
  | { type: "error" | "status"; text: string }
  | { type: "metrics"; inputTokens: number; maxContextTokens: number }
  | { type: "cleared" }
  | { type: "history"; entries: ConversationMessage[] }
  | { type: "state"; enableThinking: boolean };

export type ChatPost = (message: ChatOutgoingMessage) => Thenable<unknown> | Promise<unknown>;

export interface ChatAnswer {
  content: string;
  reasoning?: string;
}

export type PromptProgress =
  | { type: "phase"; text: string; inputTokens?: number; maxContextTokens?: number }
  | { type: "delta"; channel: "answer" | "reasoning"; text: string };

export class ChatSession {
  private readonly history: ConversationMessage[] = [];
  private currentController: AbortController | undefined;

  constructor(
    private readonly onPrompt: (
      prompt: string,
      history: ConversationMessage[],
      progress: (event: PromptProgress) => void,
      signal?: AbortSignal,
    ) => Promise<ChatAnswer | string>,
  ) {}

  async handle(message: ChatIncomingMessage, post: ChatPost): Promise<void> {
    if (message.type === "ready") {
      await post({ type: "history", entries: [...this.history] });
      return;
    }
    if (message.type === "clear") {
      this.currentController?.abort();
      this.history.length = 0;
      await post({ type: "cleared" });
      return;
    }
    if (message.type === "cancel") {
      this.currentController?.abort();
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

    await post({ type: "status", text: "Preprocessing..." });
    const previousHistory = [...this.history];
    this.history.push({ role: "user", content: prompt });
    const controller = new AbortController();
    this.currentController = controller;
    try {
      const progress = (event: PromptProgress) => {
        if (controller.signal.aborted) return;
        for (const message of progressToMessages(event)) {
          void post(message);
        }
      };
      const rawAnswer = await this.onPrompt(prompt, previousHistory, progress, controller.signal);
      if (controller.signal.aborted) {
        this.history.pop();
        return;
      }
      const answer = normalizeAnswer(rawAnswer);
      this.history.push({ role: "assistant", content: answer.content });
      await post({ type: "answer", text: answer.content, reasoning: answer.reasoning });
    } catch (error) {
      this.history.pop();
      if (controller.signal.aborted || isAbortError(error)) {
        return;
      }
      const text = error instanceof Error ? error.message : String(error);
      await post({ type: "error", text });
    } finally {
      if (this.currentController === controller) {
        this.currentController = undefined;
      }
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message === "Cancelled");
}

function normalizeAnswer(answer: ChatAnswer | string): ChatAnswer {
  return typeof answer === "string" ? { content: answer } : answer;
}

function progressToMessages(event: PromptProgress): ChatOutgoingMessage[] {
  if (event.type === "delta") {
    return [{ type: "assistantDelta", channel: event.channel, text: event.text }];
  }
  const messages: ChatOutgoingMessage[] = [{ type: "status", text: event.text }];
  if (event.inputTokens !== undefined && event.maxContextTokens !== undefined) {
    messages.push({
      type: "metrics",
      inputTokens: event.inputTokens,
      maxContextTokens: event.maxContextTokens,
    });
  }
  return messages;
}
