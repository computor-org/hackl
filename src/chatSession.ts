import type { ConversationMessage, PromptMode } from "./prompt";
import type { BasketSnapshot, HacklTarget } from "./basket";
import type { HacklReviewComment } from "./reviewComments";

export const ALLOWED_WEBVIEW_COMMANDS: ReadonlySet<string> = new Set([
  "hackl.addSelectionToContext",
  "hackl.addMarkdownSectionToContext",
  "hackl.addStagedChangesToContext",
  "hackl.addLastCommitToContext",
  "hackl.clearContext",
  "hackl.openSetupGuide",
  "hackl.discardLastAnnotations",
]);

export function isAllowedWebviewCommand(command: string): boolean {
  return ALLOWED_WEBVIEW_COMMANDS.has(command);
}

export interface ChatIncomingMessage {
  type: string;
  prompt?: string;
  mode?: PromptMode;
  approvalId?: string;
  approved?: boolean;
  value?: unknown;
  targetId?: string;
  createAnnotations?: boolean;
}

export interface HacklRequestOptions {
  createAnnotations?: boolean;
}

export type ChatOutgoingMessage =
  | { type: "answer"; text: string; reasoning?: string; reviewComments?: HacklReviewComment[] }
  | ApprovalRequest
  | { type: "assistantDelta"; channel: "answer" | "reasoning"; text: string }
  | { type: "error" | "status"; text: string }
  | { type: "metrics"; inputTokens: number; maxContextTokens: number }
  | { type: "cleared" }
  | { type: "history"; entries: ConversationMessage[] }
  | { type: "basket"; targets: HacklTarget[] }
  | { type: "userPrompt"; text: string }
  | { type: "setPromptText"; text: string }
  | ChatState
  | { type: "focusInput" };

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
  reviewComments?: HacklReviewComment[];
}

export type PromptProgress =
  | { type: "phase"; text: string; inputTokens?: number; maxContextTokens?: number }
  | { type: "target"; endpoint: string; model: string }
  | { type: "delta"; channel: "answer" | "reasoning"; text: string };

export interface ChatState {
  type: "state";
  enableThinking?: boolean;
  endpoint?: string;
  model?: string;
  endpointApprovalRequired?: boolean;
}

export type ApprovalRequester = (request: Omit<ApprovalRequest, "type" | "id">) => Promise<boolean>;

export interface PromptHandlerArgs {
  prompt: string;
  history: ConversationMessage[];
  mode: PromptMode;
  progress: (event: PromptProgress) => void;
  requestApproval: ApprovalRequester;
  signal?: AbortSignal;
  targets?: HacklTarget[];
  options?: HacklRequestOptions;
}

export type PromptHandler = (args: PromptHandlerArgs) => Promise<ChatAnswer | string>;

export interface BasketBridge {
  snapshot(): BasketSnapshot;
  onDidChange(listener: (snapshot: BasketSnapshot) => void): { dispose(): void };
  remove(id: string): void;
  clear(): void;
  reveal?(id: string): void;
}

export class ChatSession {
  private readonly history: ConversationMessage[] = [];
  private currentController: AbortController | undefined;
  private basketSubscription: { dispose(): void } | undefined;

  constructor(
    private readonly onPrompt: PromptHandler,
    private readonly basket?: BasketBridge,
  ) {}

  dispose(): void {
    this.basketSubscription?.dispose();
    this.basketSubscription = undefined;
  }

  async runDirect(
    prompt: string,
    mode: PromptMode,
    options: HacklRequestOptions,
    post: ChatPost,
  ): Promise<void> {
    await post({ type: "userPrompt", text: prompt });
    await this.handlePrompt(prompt, mode, options, post);
  }

  async handle(message: ChatIncomingMessage, post: ChatPost): Promise<void> {
    if (message.type === "ready") {
      await post({ type: "history", entries: [...this.history] });
      if (this.basket) {
        if (!this.basketSubscription) {
          this.basketSubscription = this.basket.onDidChange((snap) => {
            void post({ type: "basket", targets: snap.targets });
          });
        }
        const snap = this.basket.snapshot();
        await post({ type: "basket", targets: snap.targets });
      }
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
    if (message.type === "removeTarget" && message.targetId) {
      this.basket?.remove(message.targetId);
      return;
    }
    if (message.type === "revealTarget" && message.targetId) {
      this.basket?.reveal?.(message.targetId);
      return;
    }
    if (message.type === "clearBasket") {
      this.basket?.clear();
      return;
    }
    if (message.type === "prompt") {
      await this.handlePrompt(
        message.prompt,
        normalizeMode(message.mode),
        { createAnnotations: Boolean(message.createAnnotations) },
        post,
      );
    }
  }

  private async handlePrompt(
    rawPrompt: string | undefined,
    mode: PromptMode,
    options: HacklRequestOptions,
    post: ChatPost,
  ): Promise<void> {
    const prompt = rawPrompt?.trim();
    if (!prompt) {
      return;
    }

    await post({ type: "status", text: "Preprocessing..." });
    const previousHistory = [...this.history];
    this.history.push({ role: "user", content: prompt });
    const controller = new AbortController();
    this.currentController = controller;
    const targets = this.basket?.snapshot().targets ?? [];
    try {
      const progress = (event: PromptProgress) => {
        if (controller.signal.aborted) return;
        for (const message of progressToMessages(event)) {
          void post(message);
        }
      };
      const requestApproval = (request: Omit<ApprovalRequest, "type" | "id">) => this.requestApproval(request, post);
      const rawAnswer = await this.onPrompt({
        prompt,
        history: previousHistory,
        mode,
        progress,
        requestApproval,
        signal: controller.signal,
        targets,
        options,
      });
      if (controller.signal.aborted) {
        this.history.pop();
        return;
      }
      const answer = normalizeAnswer(rawAnswer);
      this.history.push({ role: "assistant", content: answer.content });
      const out: ChatOutgoingMessage = { type: "answer", text: answer.content, reasoning: answer.reasoning };
      if (answer.reviewComments && answer.reviewComments.length > 0) {
        (out as { reviewComments?: HacklReviewComment[] }).reviewComments = answer.reviewComments;
      }
      await post(out);
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
  if (mode === "agent" || mode === "work" || mode === "edit") {
    return mode;
  }
  return "ask";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message === "Cancelled");
}

function normalizeAnswer(answer: ChatAnswer | string): ChatAnswer {
  return typeof answer === "string" ? { content: answer } : answer;
}

function progressToMessages(event: PromptProgress): ChatOutgoingMessage[] {
  if (event.type === "target") {
    return [{
      type: "state",
      endpoint: event.endpoint,
      model: event.model,
      endpointApprovalRequired: false,
    }];
  }
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
