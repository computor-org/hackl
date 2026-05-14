import * as vscode from "vscode";
import { ChatMessage, createOpenAICompatibleBackend } from "./chatClient";
import { ChatPanel } from "./chatPanel";
import {
  ApprovalRequester,
  BasketBridge,
  ChatAnswer,
  ChatState,
  HacklRequestOptions,
  PromptProgress,
} from "./chatSession";
import type { ConversationMessage } from "./prompt";
import { ChatViewProvider } from "./chatView";
import { buildPromptContext, collectEditorContext } from "./context";
import {
  detectMaxContextTokens,
  LOCAL_SERVER_CANDIDATES,
  probeAll,
  ProbeResult,
  requiresNonLocalEndpointApproval,
  resolveChatTarget,
} from "./localServers";
import { buildHacklMessages, PromptMode, splitMultiQuestion } from "./prompt";
import { completeWithTools } from "./toolLoop";
import { estimateChatTokens, formatTokenBudget } from "./tokenBudget";
import { createWorkspaceToolRunner } from "./workspaceTools";
import { createDebugLog, disposeDebugLog } from "./debugLog";
import { SetupPanel } from "./setup/setupView";
import {
  BasketService,
  BasketSnapshot,
  HacklTarget,
  ReviewContext,
  createMarkdownSectionTarget,
  createReviewNoteTarget,
  createSourceRangeTarget,
  describeTarget,
} from "./basket";
import { HacklReviewComment, ReviewCommentController, parseReviewCommentsFromAnswer } from "./reviewComments";
import { buildLastCommitTarget, buildStagedChangesTarget } from "./gitTargets";
import { HacklSessionRecord, newHacklSessionId, persistHacklSession } from "./hacklSession";

let chatPanel: ChatPanel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let basketService: BasketService | undefined;
let reviewController: ReviewCommentController | undefined;
let sessionFinishedEmitter: vscode.EventEmitter<HacklSessionRecord> | undefined;
const detectedContextCache = new Map<string, number | undefined>();

export interface HacklApi {
  readonly version: 1;
  getBasket(): BasketSnapshot;
  addTarget(target: HacklTarget): void;
  removeTarget(id: string): void;
  clearBasket(): void;
  setReviewContext(context: ReviewContext | undefined): void;
  getReviewContext(): ReviewContext | undefined;
  addReviewComment(comment: Omit<HacklReviewComment, "id" | "status" | "createdAt"> & {
    status?: HacklReviewComment["status"];
    createdAt?: number;
  }): HacklReviewComment;
  clearReviewComments(): void;
  onDidChangeBasket: vscode.Event<BasketSnapshot>;
  onDidFinishSession: vscode.Event<HacklSessionRecord>;
  openChat(): Thenable<void>;
}

interface ConfigInspection<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
  globalLanguageValue?: T;
  workspaceLanguageValue?: T;
  workspaceFolderLanguageValue?: T;
}

export function activate(context: vscode.ExtensionContext): HacklApi {
  basketService = new BasketService();
  reviewController = new ReviewCommentController();
  sessionFinishedEmitter = new vscode.EventEmitter<HacklSessionRecord>();
  const basketBridge = makeBasketBridge(basketService);

  const chatViewProvider = new ChatViewProvider(context, answerPrompt, currentChatState, basketBridge);
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBarItem.command = "hackl.openSetupGuide";
  context.subscriptions.push(statusBarItem, basketService, reviewController, sessionFinishedEmitter);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider),
    vscode.commands.registerCommand("hackl.chat", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.hackl");
      chatViewProvider.show();
      chatViewProvider.focusInput();
    }),
    vscode.commands.registerCommand("hackl.chatEditor", () => {
      openChatPanel(context, basketBridge);
      chatPanel?.focusInput();
    }),
    vscode.commands.registerCommand("hackl.openSetupGuide", () => {
      SetupPanel.show(context, runProbe, setEndpoint);
    }),
    vscode.commands.registerCommand("hackl.checkLocalServer", async () => {
      const probe = await runProbe();
      await reportProbe(probe);
    }),
    vscode.commands.registerCommand("hackl.refreshEndpoint", async () => {
      detectedContextCache.clear();
      SetupPanel.refresh();
      const probe = await runProbe();
      await reportProbe(probe);
    }),
    vscode.commands.registerCommand("hackl.openSetupDoc", async (which: "lmstudio" | "llamacpp" | "ollama") => {
      const file = `setup-${which}.md`;
      const uri = vscode.Uri.joinPath(context.extensionUri, "docs", file);
      await vscode.commands.executeCommand("markdown.showPreview", uri);
    }),
    vscode.commands.registerCommand("hackl.replyToReviewThread", async (reply: vscode.CommentReply) => {
      await handleReviewReply(reply);
    }),
    vscode.commands.registerCommand("hackl.deleteReviewThread", (thread: vscode.CommentThread) => {
      handleDeleteReviewThread(thread);
    }),
    vscode.commands.registerCommand("hackl.addSelectionToContext", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showInformationMessage("Hackl: select code in the editor first.");
        return;
      }
      const target = createSourceRangeTarget(editor);
      if (target) addAndReveal(basketService!, target, chatViewProvider);
    }),
    vscode.commands.registerCommand("hackl.addMarkdownSectionToContext", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("Hackl: open a Markdown file first.");
        return;
      }
      const target = createMarkdownSectionTarget(editor);
      if (!target) {
        vscode.window.showInformationMessage("Hackl: active document is not Markdown.");
        return;
      }
      addAndReveal(basketService!, target, chatViewProvider);
    }),
    vscode.commands.registerCommand("hackl.clearContext", () => {
      basketService!.clear();
    }),
    vscode.commands.registerCommand("hackl.addStagedChangesToContext", async () => {
      const result = await buildStagedChangesTarget();
      if ("error" in result) {
        vscode.window.showWarningMessage(`Hackl: ${result.error}`);
        return;
      }
      addAndReveal(basketService!, result, chatViewProvider);
    }),
    vscode.commands.registerCommand("hackl.addLastCommitToContext", async () => {
      const result = await buildLastCommitTarget();
      if ("error" in result) {
        vscode.window.showWarningMessage(`Hackl: ${result.error}`);
        return;
      }
      addAndReveal(basketService!, result, chatViewProvider);
    }),
    vscode.commands.registerCommand("hackl.clearReviewComments", () => {
      reviewController?.clear();
    }),
    vscode.commands.registerCommand("hackl.revealTarget", async (id: string) => {
      const target = basketService!.list().find((t) => t.id === id);
      if (!target) return;
      const uri = (target as { uri?: string }).uri;
      const startLine = (target as { startLine?: number }).startLine;
      const endLine = (target as { endLine?: number }).endLine;
      if (!uri) return;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
      if (startLine !== undefined) {
        const start = new vscode.Position(Math.max(0, startLine - 1), 0);
        const end = new vscode.Position(Math.max(0, (endLine ?? startLine) - 1), 0);
        editor.selection = new vscode.Selection(start, end);
        editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
      }
    }),
    vscode.commands.registerCommand("hackl.reviewStagedChanges", async () => {
      const result = await buildStagedChangesTarget();
      if ("error" in result) {
        vscode.window.showWarningMessage(`Hackl: ${result.error}`);
        return;
      }
      basketService!.clear();
      basketService!.add(result);
      await vscode.commands.executeCommand("hackl.chat");
      await chatViewProvider.submitPreset(
        "Review the staged changes for correctness, regressions, missing tests, and risky assumptions.",
        "ask",
        { createAnnotations: true },
      );
    }),
  );

  void refreshStatus();

  const api: HacklApi = {
    version: 1,
    getBasket: () => basketService!.snapshot(),
    addTarget: (target) => basketService!.add(target),
    removeTarget: (id) => basketService!.remove(id),
    clearBasket: () => basketService!.clear(),
    setReviewContext: (ctx) => basketService!.setReviewContext(ctx),
    getReviewContext: () => basketService!.getReviewContext(),
    addReviewComment: (comment) => reviewController!.add({
      ...comment,
      authorType: comment.authorType ?? "human",
    }),
    clearReviewComments: () => reviewController!.clear(),
    onDidChangeBasket: basketService.onDidChange,
    onDidFinishSession: sessionFinishedEmitter.event,
    openChat: () => vscode.commands.executeCommand("hackl.chat"),
  };
  return api;
}

function makeBasketBridge(basket: BasketService): BasketBridge {
  return {
    snapshot: () => basket.snapshot(),
    onDidChange: (listener: (snap: BasketSnapshot) => void) => basket.onDidChange(listener),
    remove: (id: string) => basket.remove(id),
    clear: () => basket.clear(),
    reveal: (id: string) => void vscode.commands.executeCommand("hackl.revealTarget", id),
  };
}

async function handleReviewReply(reply: vscode.CommentReply): Promise<void> {
  if (!basketService || !reviewController) return;
  const text = (reply.text ?? "").trim();
  if (!text) return;
  const thread = reply.thread;
  const range = thread.range;
  if (!range) return;
  const document = await vscode.workspace.openTextDocument(thread.uri);
  const startLineIdx = Math.max(0, Math.min(range.start.line, document.lineCount - 1));
  const endLineIdx = Math.max(startLineIdx, Math.min(range.end.line, document.lineCount - 1));
  const endLineText = document.lineAt(endLineIdx).text;
  const code = document.getText(new vscode.Range(startLineIdx, 0, endLineIdx, endLineText.length));
  const startLine = startLineIdx + 1;
  const endLine = endLineIdx + 1;
  const threadKey = `${thread.uri.toString()}#${startLine}-${endLine}`;
  const target = createReviewNoteTarget({
    uri: thread.uri.toString(),
    languageId: document.languageId,
    relativePath: vscode.workspace.asRelativePath(thread.uri, false),
    startLine,
    endLine,
    endCharacter: endLineText.length + 1,
    code,
    note: text,
    threadKey,
  });
  basketService.add(target);
  reviewController.registerHumanComment(thread, text);
}

function handleDeleteReviewThread(thread: vscode.CommentThread): void {
  if (!basketService || !reviewController) return;
  const range = thread.range;
  const key = range
    ? `${thread.uri.toString()}#${range.start.line + 1}-${range.end.line + 1}`
    : undefined;
  if (key) {
    for (const target of basketService.list()) {
      const meta = target.metadata as { threadKey?: string } | undefined;
      if (meta?.threadKey === key) basketService.remove(target.id);
    }
  }
  reviewController.disposeThread(thread);
}

function addAndReveal(basket: BasketService, target: HacklTarget, view: ChatViewProvider): void {
  basket.add(target);
  view.show();
  vscode.window.setStatusBarMessage(`Hackl: added ${describeTarget(target)}`, 2000);
}

async function refreshStatus(): Promise<void> {
  if (!statusBarItem) return;
  const config = vscode.workspace.getConfiguration("hackl");
  const endpoint = (config.get<string>("endpoint", "") || "").trim();
  const endpointConfigured = hasUserConfigured(config.inspect<string>("endpoint"));
  const probe = await tryProbe(endpoint, endpointConfigured);
  if (probe?.ok) {
    statusBarItem.text = `$(pulse) ${probe.model ?? "Hackl"}`;
    statusBarItem.tooltip = `Hackl connected to ${probe.endpoint}`;
  } else {
    statusBarItem.text = "$(plug) Hackl: connect";
    statusBarItem.tooltip = "No local model server detected. Click for setup help.";
  }
  statusBarItem.show();
}

async function tryProbe(endpoint: string, endpointConfigured: boolean): Promise<ProbeResult | undefined> {
  const candidates = endpointConfigured && endpoint
    ? [{ name: "configured", endpoint }]
    : LOCAL_SERVER_CANDIDATES;
  const results = await probeAll(candidates);
  return results.find((r) => r.ok);
}

async function runProbe(): Promise<ProbeResult[]> {
  const config = vscode.workspace.getConfiguration("hackl");
  const endpoint = (config.get<string>("endpoint", "") || "").trim();
  const endpointConfigured = hasUserConfigured(config.inspect<string>("endpoint"));
  const candidates = endpointConfigured && endpoint
    ? [{ name: "configured", endpoint }]
    : LOCAL_SERVER_CANDIDATES;
  return probeAll(candidates);
}

async function reportProbe(probes: ProbeResult[]): Promise<void> {
  const ok = probes.find((p) => p.ok);
  if (ok) {
    const ctx = ok.ctx ? ` · ${Math.floor(ok.ctx / 1024)}k ctx` : "";
    vscode.window.showInformationMessage(`Hackl: ${ok.endpoint} ready (${ok.model ?? "model"})${ctx}.`);
  } else {
    const choice = await vscode.window.showWarningMessage(
      "Hackl: no local model server detected on the configured or default endpoints.",
      "Open setup guide",
    );
    if (choice === "Open setup guide") {
      await vscode.commands.executeCommand("hackl.openSetupGuide");
    }
  }
  await refreshStatus();
}

async function setEndpoint(endpoint: string): Promise<void> {
  await vscode.workspace.getConfiguration("hackl").update(
    "endpoint",
    endpoint,
    vscode.ConfigurationTarget.Global,
  );
  detectedContextCache.clear();
  await refreshStatus();
  SetupPanel.refresh();
}

export function deactivate(): void {
  chatPanel = undefined;
  statusBarItem = undefined;
  basketService = undefined;
  reviewController = undefined;
  disposeDebugLog();
}

async function answerPrompt(
  prompt: string,
  history: ConversationMessage[] = [],
  mode: PromptMode = "ask",
  progress?: (event: PromptProgress) => void,
  requestApproval?: ApprovalRequester,
  signal?: AbortSignal,
  targets: HacklTarget[] = [],
  options: HacklRequestOptions = {},
): Promise<ChatAnswer> {
  const createAnnotations = Boolean(options.createAnnotations);
  const startedAt = Date.now();
  progress?.({ type: "phase", text: "Preprocessing prompt..." });
  const config = vscode.workspace.getConfiguration("hackl");
  const configuredEndpoint = config.get<string>("endpoint", "");
  const endpointConfigured = hasUserConfigured(config.inspect<string>("endpoint"));
  const endpointApproval = await requireEndpointApproval(configuredEndpoint, endpointConfigured, requestApproval);
  if (endpointApproval) {
    return endpointApproval;
  }
  const target = await resolveChatTarget({
    endpoint: configuredEndpoint,
    endpointConfigured,
  });
  progress?.({ type: "target", endpoint: target.endpoint, model: target.model });
  const maxToolFileChars = config.get<number>("maxToolFileChars", 12000);
  const debug = createDebugLog(config.get<boolean>("debug", false));
  const configuredMaxContext = hasUserConfigured(config.inspect<number>("maxContextTokens"))
    ? config.get<number>("maxContextTokens", 32768)
    : undefined;
  const detectedMaxContext = configuredMaxContext === undefined
    ? await getDetectedMaxContext(target.endpoint)
    : undefined;
  const maxContextTokens = configuredMaxContext ?? detectedMaxContext ?? 32768;
  const enableThinking = config.get<boolean>("enableThinking", false);
  debug?.("prompt.start", {
    mode,
    endpoint: target.endpoint,
    model: target.model,
    maxToolFileChars,
    enableThinking,
    targets: targets.length,
    createAnnotations,
  });
  const contextText = buildPromptContext(collectEditorContext(), { maxToolFileChars });
  const questions = splitMultiQuestion(prompt);
  const reviewContext = basketService?.getReviewContext();
  const messages: ChatMessage[] = buildHacklMessages(prompt, contextText, history, mode, {
    targets,
    questions,
    reviewContext,
    createAnnotations,
  });
  const inputTokens = estimateChatTokens(messages);
  debug?.("prompt.context", { inputTokens, maxContextTokens, messages: messages.length });
  progress?.({
    type: "phase",
    text: `Preprocessing ${Date.now() - startedAt} ms · ${formatTokenBudget(inputTokens, maxContextTokens)}`,
    inputTokens,
    maxContextTokens,
  });
  progress?.({ type: "phase", text: "Model request..." });

  const modelStartedAt = Date.now();
  const allowEdits = mode === "edit" || mode === "work" || mode === "agent";
  const answer = await completeWithTools({
    backend: createOpenAICompatibleBackend({ ...target, enableThinking }),
    messages,
    runTool: createWorkspaceToolRunner({
      maxFileChars: maxToolFileChars,
      allowEdits,
      allowSearch: mode === "work" || mode === "agent",
      allowCommands: mode === "agent",
      requestApproval,
      signal,
    }),
    maxToolCalls: toolCallLimit(mode),
    maxContextTokens,
    progress,
    debug,
    signal,
  });
  debug?.("prompt.answer", answer);
  progress?.({ type: "phase", text: `Model finished in ${Date.now() - modelStartedAt} ms` });

  const result: ChatAnswer = { content: answer.content, reasoning: answer.reasoning };
  let createdComments: HacklReviewComment[] = [];
  if (createAnnotations && reviewController) {
    const parsed = parseReviewCommentsFromAnswer(answer.content, defaultUriForReview(targets), { aiModel: target.model });
    const withTargetIds = parsed.map((c) => ({ ...c, targetId: findTargetIdForComment(c, targets) }));
    createdComments = withTargetIds.map((c) => reviewController!.add(c));
    if (createdComments.length > 0) {
      result.reviewComments = createdComments;
      vscode.window.setStatusBarMessage(`Hackl: ${createdComments.length} annotation${createdComments.length === 1 ? "" : "s"}`, 3000);
    } else {
      vscode.window.setStatusBarMessage("Hackl: no annotations parsed — showing raw answer.", 4000);
    }
  }
  if (createAnnotations) {
    await emitHacklSession({
      mode,
      endpoint: target.endpoint,
      model: target.model,
      targets,
      reviewContext,
      questions,
      answer: answer.content,
      comments: createdComments,
    });
  }
  return result;
}

function findTargetIdForComment(
  comment: { uri: string; startLine: number; endLine: number },
  targets: HacklTarget[],
): string | undefined {
  for (const t of targets) {
    if (t.kind === "source-range" || t.kind === "markdown-section") {
      if (t.uri === comment.uri && t.startLine <= comment.startLine && t.endLine >= comment.endLine) {
        return t.id;
      }
    }
  }
  for (const t of targets) {
    if ((t.kind === "source-range" || t.kind === "markdown-section") && t.uri === comment.uri) {
      return t.id;
    }
  }
  return undefined;
}

async function emitHacklSession(input: {
  mode: PromptMode;
  endpoint: string;
  model: string;
  targets: HacklTarget[];
  reviewContext?: ReviewContext;
  questions?: string[];
  answer: string;
  comments: HacklReviewComment[];
}): Promise<void> {
  const session: HacklSessionRecord = {
    id: newHacklSessionId(),
    createdAt: new Date().toISOString(),
    mode: input.mode,
    endpoint: input.endpoint,
    model: input.model,
    targets: input.targets,
    context: input.reviewContext,
    questions: input.questions && input.questions.length > 1 ? input.questions : undefined,
    answer: input.answer,
    comments: input.comments,
  };
  sessionFinishedEmitter?.fire(session);
  const config = vscode.workspace.getConfiguration("hackl");
  if (!config.get<boolean>("persistSessions", true)) return;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  try {
    await persistHacklSession(root, session);
  } catch (error) {
    vscode.window.setStatusBarMessage(
      `Hackl: failed to persist session (${error instanceof Error ? error.message : String(error)})`,
      4000,
    );
  }
}

function defaultUriForReview(targets: HacklTarget[]): string | undefined {
  for (const target of targets) {
    if (target.kind === "source-range" || target.kind === "markdown-section") return target.uri;
  }
  return undefined;
}

function toolCallLimit(mode: PromptMode): number {
  if (mode === "agent") return 48;
  if (mode === "work") return 24;
  if (mode === "edit") return 12;
  return 4;
}

async function requireEndpointApproval(
  endpoint: string,
  endpointConfigured: boolean,
  requestApproval?: ApprovalRequester,
): Promise<ChatAnswer | undefined> {
  if (!endpointConfigured || !requiresNonLocalEndpointApproval(endpoint)) {
    return undefined;
  }
  const approved = await requestApproval?.({
    title: "Use non-local endpoint?",
    detail: `Hackl is configured to send prompts and selected context to ${endpoint.trim()}. Continue?`,
    approveLabel: "Use endpoint",
    denyLabel: "Cancel",
  }) ?? false;
  return approved
    ? undefined
    : { content: "Request cancelled because hackl.endpoint is configured to a non-local endpoint." };
}

async function currentChatState(): Promise<ChatState> {
  const config = vscode.workspace.getConfiguration("hackl");
  const endpoint = config.get<string>("endpoint", "");
  const endpointConfigured = hasUserConfigured(config.inspect<string>("endpoint"));
  const enableThinking = config.get<boolean>("enableThinking", false);
  if (endpointConfigured && requiresNonLocalEndpointApproval(endpoint)) {
    return {
      type: "state",
      enableThinking,
      endpoint: endpoint.trim(),
      endpointApprovalRequired: true,
    };
  }
  const target = await resolveChatTarget({ endpoint, endpointConfigured });
  return {
    type: "state",
    enableThinking,
    endpoint: target.endpoint,
    model: target.model,
    endpointApprovalRequired: false,
  };
}

function hasUserConfigured<T>(inspection: ConfigInspection<T> | undefined): boolean {
  if (!inspection) {
    return false;
  }

  return [
    inspection.globalValue,
    inspection.workspaceValue,
    inspection.workspaceFolderValue,
    inspection.globalLanguageValue,
    inspection.workspaceLanguageValue,
    inspection.workspaceFolderLanguageValue,
  ].some((value) => value !== undefined && (typeof value !== "string" || value.trim() !== ""));
}

async function getDetectedMaxContext(endpoint: string): Promise<number | undefined> {
  if (detectedContextCache.has(endpoint)) {
    return detectedContextCache.get(endpoint);
  }
  const detected = await detectMaxContextTokens(endpoint).catch(() => undefined);
  detectedContextCache.set(endpoint, detected);
  return detected;
}

function openChatPanel(context: vscode.ExtensionContext, basket?: BasketBridge): void {
  if (!chatPanel) {
    chatPanel = new ChatPanel(context, answerPrompt, currentChatState, () => {
      chatPanel = undefined;
    }, basket);
  }
  chatPanel.reveal();
}
