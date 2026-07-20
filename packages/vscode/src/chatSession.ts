import type { ConversationMessage, PromptMode } from "@hackl/core";
import type { BasketSnapshot, HacklTarget } from "./basket";
import type { HacklAnnotation } from "./annotations";

export const ALLOWED_WEBVIEW_COMMANDS: ReadonlySet<string> = new Set([
  "hackl.attachContext",
  "hackl.addSelectionToContext",
  "hackl.addCurrentFileToContext",
  "hackl.addMarkdownSectionToContext",
  "hackl.addStagedChangesToContext",
  "hackl.addLastCommitToContext",
  "hackl.clearContext",
  "hackl.discardLastAnnotations",
  "hackl.selectBackend",
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
  backendKind?: "local" | "codex";
  model?: string;
}

export interface HacklRequestOptions {
  createAnnotations?: boolean;
}

export const DEFAULT_ANNOTATION_PROMPT = "Review the attached context and produce Hackl annotations.";
export const DEFAULT_ANNOTATION_CONTEXT_PROMPT = "Address the attached annotation comments.";
export const DEFAULT_REVIEW_PROMPT = "Review the selected context for correctness, regressions, missing tests, risky assumptions, unclear code, and maintainability. Add concise line-anchored annotations for concrete findings. Do not edit files.";

export type ParsedCommand =
  | { kind: "review"; prompt: string; createAnnotations: true; forceMode: "ask" }
  | { kind: "freeform"; prompt: string; createAnnotations: false };

export function parseSlashCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (trimmed === "/review") {
    return {
      kind: "review",
      prompt: DEFAULT_REVIEW_PROMPT,
      createAnnotations: true,
      forceMode: "ask",
    };
  }
  return {
    kind: "freeform",
    prompt: input,
    createAnnotations: false,
  };
}

export type ChatOutgoingMessage =
  | { type: "answer"; text: string; reasoning?: string; annotations?: HacklAnnotation[] }
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
  annotations?: HacklAnnotation[];
}

export type PromptProgress =
  | { type: "phase"; text: string; inputTokens?: number; maxContextTokens?: number }
  | { type: "target"; endpoint: string; model: string }
  | { type: "delta"; channel: "answer" | "reasoning"; text: string };

export interface ChatBackendsState {
  local: { available: boolean; endpoint?: string; model?: string; models?: string[] };
  codex: { available: boolean; models: string[]; authMode: "chatgpt" | "apikey" | "none"; needsLogin: boolean };
  current: { kind: "local" | "codex"; model?: string };
}

export interface ChatState {
  type: "state";
  enableThinking?: boolean;
  connected?: boolean;
  endpoint?: string;
  model?: string;
  endpointApprovalRequired?: boolean;
  backends?: ChatBackendsState;
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
export type ReviewTargetResolver = () => Promise<HacklTarget[] | { error: string }>;

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
    private readonly resolveReviewTargets?: ReviewTargetResolver,
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
    const parsed = parseSlashCommand(rawPrompt ?? "");
    const hasAnnotationContext = hasAnnotationNoteTargets(this.basket?.snapshot().targets ?? []);
    const prompt = parsed.kind === "review"
      ? parsed.prompt
      : rawPrompt?.trim()
        || (options.createAnnotations ? DEFAULT_ANNOTATION_PROMPT : "")
        || (hasAnnotationContext ? DEFAULT_ANNOTATION_CONTEXT_PROMPT : "");
    if (!prompt) {
      return;
    }
    const effectiveMode = parsed.kind === "review" ? parsed.forceMode : mode;
    const effectiveOptions = parsed.kind === "review"
      ? { ...options, createAnnotations: parsed.createAnnotations }
      : options;

    await post({ type: "status", text: "Preprocessing..." });
    const previousHistory = [...this.history];
    this.history.push({ role: "user", content: prompt });
    const controller = new AbortController();
    this.currentController = controller;
    try {
      const targets = await this.targetsForPrompt(parsed);
      if ("error" in targets) {
        this.history.pop();
        await post({ type: "error", text: targets.error });
        return;
      }
      if (parsed.kind === "review") {
        await post({ type: "status", text: describeReviewTargets(targets) });
      }
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
        mode: effectiveMode,
        progress,
        requestApproval,
        signal: controller.signal,
        targets,
        options: effectiveOptions,
      });
      if (controller.signal.aborted) {
        this.history.pop();
        return;
      }
      const answer = normalizeAnswer(rawAnswer);
      this.history.push({ role: "assistant", content: answer.content });
      const out: ChatOutgoingMessage = { type: "answer", text: answer.content, reasoning: answer.reasoning };
      if (answer.annotations && answer.annotations.length > 0) {
        (out as { annotations?: HacklAnnotation[] }).annotations = answer.annotations;
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

  private async targetsForPrompt(command: ParsedCommand): Promise<HacklTarget[] | { error: string }> {
    if (command.kind === "review") {
      if (this.resolveReviewTargets) return this.resolveReviewTargets();
      const targets = this.basket?.snapshot().targets ?? [];
      return targets.length > 0 ? targets : { error: "Select code or attach context first." };
    }
    return this.basket?.snapshot().targets ?? [];
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

function hasAnnotationNoteTargets(targets: HacklTarget[]): boolean {
  return targets.some((target) => Boolean((target.metadata as { note?: string } | undefined)?.note));
}

function describeReviewTargets(targets: HacklTarget[]): string {
  const lines = ["Reviewing:"];
  for (const target of targets) {
    lines.push(`- ${describeReviewTarget(target)}`);
  }
  return lines.join("\n");
}

function describeReviewTarget(target: HacklTarget): string {
  if (target.kind === "staged-changes") {
    return `staged changes: ${target.files.length} file${target.files.length === 1 ? "" : "s"}`;
  }
  if (target.kind === "source-range") {
    return `${target.relativePath} lines ${target.startLine}-${target.endLine}`;
  }
  if (target.kind === "markdown-section") {
    const heading = target.headingPath.length ? ` section "${target.headingPath.join(" > ")}"` : "";
    return `${target.relativePath}${heading} lines ${target.startLine}-${target.endLine}`;
  }
  return `commit ${target.sha.slice(0, 7)}: ${target.files.length} file${target.files.length === 1 ? "" : "s"}`;
}

function normalizeMode(mode: PromptMode | undefined): PromptMode {
  if (mode === "yolo" || mode === "agent" || mode === "work" || mode === "edit") {
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
      connected: true,
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
