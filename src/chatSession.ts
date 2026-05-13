import type { ConversationMessage, PromptMode } from "./prompt";

export interface ChatIncomingMessage {
  type: string;
  prompt?: string;
  mode?: PromptMode;
  approvalId?: string;
  approved?: boolean;
  value?: unknown;
}

export type ChatOutgoingMessage =
  | { type: "answer"; text: string; reasoning?: string }
  | ApprovalRequest
  | { type: "assistantDelta"; channel: "answer" | "reasoning"; text: string }
  | { type: "error" | "status"; text: string }
  | { type: "metrics"; inputTokens: number; maxContextTokens: number }
  | { type: "cleared" }
  | { type: "history"; entries: ConversationMessage[] }
  | { type: "state"; enableThinking: boolean };

export type ChatPost = (message: ChatOutgoingMessage) => Thenable<unknown> | Promise<unknown>;

export interface ApprovalRequest {
  type: "approvalRequested";
  id: string;
  title: string;
  detail: string;
  approveLabel: string;
  denyLabel: string;
}

export interface ChatAnswer {
  content: string;
  reasoning?: string;
}

export type PromptProgress =
  | { type: "phase"; text: string; inputTokens?: number; maxContextTokens?: number }
  | { type: "delta"; channel: "answer" | "reasoning"; text: string };

export type ApprovalRequester = (request: Omit<ApprovalRequest, "type" | "id">) => Promise<boolean>;

export class ChatSession {
  private readonly history: ConversationMessage[] = [];
  private currentController: AbortController | undefined;

  constructor(
    private readonly onPrompt: (
      prompt: string,
      history: ConversationMessage[],
      mode: PromptMode,
      progress: (event: PromptProgress) => void,
      requestApproval: ApprovalRequester,
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
      this.rejectApprovals();
      return;
    }
    if (message.type === "approvalResponse" && message.approvalId) {
      this.resolveApproval(message.approvalId, Boolean(message.approved));
      return;
    }
    if (message.type === "prompt") {
      await this.handlePrompt(message.prompt, normalizeMode(message.mode), post);
    }
  }

  private async handlePrompt(rawPrompt: string | undefined, mode: PromptMode, post: ChatPost): Promise<void> {
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
      const requestApproval = (request: Omit<ApprovalRequest, "type" | "id">) => this.requestApproval(request, post);
      const rawAnswer = await this.onPrompt(prompt, previousHistory, mode, progress, requestApproval, controller.signal);
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
      this.rejectApprovals();
    }
  }

  private readonly approvals = new Map<string, (approved: boolean) => void>();
  private nextApprovalId = 1;

  private async requestApproval(
    request: Omit<ApprovalRequest, "type" | "id">,
    post: ChatPost,
  ): Promise<boolean> {
    const id = String(this.nextApprovalId++);
    await post({ ...request, type: "approvalRequested", id });
    return new Promise((resolve) => {
      this.approvals.set(id, resolve);
    });
  }

  private resolveApproval(id: string, approved: boolean): void {
    const resolve = this.approvals.get(id);
    if (!resolve) {
      return;
    }
    this.approvals.delete(id);
    resolve(approved);
  }

  private rejectApprovals(): void {
    for (const resolve of this.approvals.values()) {
      resolve(false);
    }
    this.approvals.clear();
  }
}

function normalizeMode(mode: PromptMode | undefined): PromptMode {
  if (mode === "agent" || mode === "yolo") {
    return mode;
  }
  if (mode === "work") {
    return "work";
  }
  return mode === "edit" ? "edit" : "ask";
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
