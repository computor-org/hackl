import * as vscode from "vscode";
import { ChatMessage, createOpenAICompatibleBackend } from "./chatClient";
import {
  ApprovalRequester,
  BasketBridge,
  ChatAnswer,
  ChatState,
  PromptHandlerArgs,
} from "./chatSession";
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
import { buildHacklMessages, PromptMode } from "./prompt";
import { completeWithTools } from "./toolLoop";
import { estimateChatTokens, formatTokenBudget } from "./tokenBudget";
import { createWorkspaceToolRunner } from "./workspaceTools";
import { createDebugLog, disposeDebugLog } from "./debugLog";
import { SetupPanel } from "./setup/setupView";
import {
  BasketService,
  BasketSnapshot,
  HacklTarget,
  createMarkdownSectionTarget,
  createSourceRangeTarget,
  describeTarget,
} from "./basket";
import { HacklAnnotation, AnnotationController, parseAnnotationsFromAnswer } from "./annotations";
import { filterAnnotationsForTargets, targetRevealLocation } from "./targetResolve";
import { buildLastCommitTarget, buildStagedChangesTarget } from "./gitTargets";
import { HacklSessionRecord, newHacklSessionId, persistHacklSession } from "./hacklSession";
import { handleAnnotationReply, handleDeleteAnnotationThread } from "./annotationCommands";
import { readHacklConfig, hasUserConfigured } from "./config";

let statusBarItem: vscode.StatusBarItem | undefined;
let basketService: BasketService | undefined;
let annotationController: AnnotationController | undefined;
let sessionFinishedEmitter: vscode.EventEmitter<HacklSessionRecord> | undefined;
const detectedContextCache = new Map<string, number | undefined>();

export interface HacklApi {
  readonly version: 1;
  getBasket(): BasketSnapshot;
  addTarget(target: HacklTarget): void;
  removeTarget(id: string): void;
  clearBasket(): void;
  onDidChangeBasket: vscode.Event<BasketSnapshot>;
  onDidFinishSession: vscode.Event<HacklSessionRecord>;
  openChat(): Thenable<void>;
}

export function activate(context: vscode.ExtensionContext): HacklApi {
  basketService = new BasketService();
  annotationController = new AnnotationController();
  sessionFinishedEmitter = new vscode.EventEmitter<HacklSessionRecord>();
  const basketBridge = makeBasketBridge(basketService);

  const chatViewProvider = new ChatViewProvider(context, answerPrompt, currentChatState, basketBridge);
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBarItem.command = "hackl.openSetupGuide";
  context.subscriptions.push(statusBarItem, basketService, annotationController, sessionFinishedEmitter);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider),
    vscode.commands.registerCommand("hackl.chat", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.hackl");
      chatViewProvider.show();
      chatViewProvider.focusInput();
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
    vscode.commands.registerCommand("hackl.replyToAnnotationThread", async (reply: vscode.CommentReply) => {
      if (!basketService || !annotationController) return;
      await handleAnnotationReply(reply, basketService, annotationController);
      await vscode.commands.executeCommand("hackl.chat");
      chatViewProvider.notifyStatus(
        `Reply attached to basket from ${vscode.workspace.asRelativePath(reply.thread.uri, false)}:${(reply.thread.range?.start.line ?? 0) + 1}`,
      );
    }),
    vscode.commands.registerCommand("hackl.deleteAnnotationThread", (thread: vscode.CommentThread) => {
      if (!basketService || !annotationController) return;
      handleDeleteAnnotationThread(thread, basketService, annotationController);
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
    vscode.commands.registerCommand("hackl.clearAnnotations", () => {
      annotationController?.clear();
    }),
    vscode.commands.registerCommand("hackl.discardLastAnnotations", () => {
      const n = annotationController?.discardLastBatch() ?? 0;
      vscode.window.setStatusBarMessage(
        n > 0 ? `Hackl: discarded ${n} annotation${n === 1 ? "" : "s"}` : "Hackl: no recent annotations to discard",
        2000,
      );
    }),
    vscode.commands.registerCommand("hackl.revealTarget", async (id: string) => {
      const target = basketService!.list().find((t) => t.id === id);
      if (!target) return;
      const location = targetRevealLocation(target);
      if (!location) return;
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(location.uri));
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        if (location.startLine !== undefined) {
          const start = new vscode.Position(Math.max(0, location.startLine - 1), 0);
          const end = new vscode.Position(Math.max(0, (location.endLine ?? location.startLine) - 1), 0);
          editor.selection = new vscode.Selection(start, end);
          editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
        }
      } catch (error) {
        vscode.window.showWarningMessage(
          `Hackl: could not reveal ${describeTarget(target)} (${error instanceof Error ? error.message : String(error)}).`,
        );
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
      chatViewProvider.setPromptText(
        "Review the staged changes for correctness, regressions, missing tests, and risky assumptions.",
      );
      chatViewProvider.setCreateAnnotations(true);
      chatViewProvider.notifyStatus("Annotations toggle is enabled — press Send to run the review.");
    }),
  );

  void refreshStatus();
  void pruneSessionsAtStartup();

  const api: HacklApi = {
    version: 1,
    getBasket: () => basketService!.snapshot(),
    addTarget: (target) => basketService!.add(target),
    removeTarget: (id) => basketService!.remove(id),
    clearBasket: () => basketService!.clear(),
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

function addAndReveal(basket: BasketService, target: HacklTarget, view: ChatViewProvider): void {
  basket.add(target);
  view.show();
  vscode.window.setStatusBarMessage(`Hackl: added ${describeTarget(target)}`, 2000);
}

async function refreshStatus(): Promise<void> {
  if (!statusBarItem) return;
  const cfg = readHacklConfig();
  const probe = await tryProbe(cfg.endpoint, cfg.endpointConfigured);
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
  const cfg = readHacklConfig();
  const candidates = cfg.endpointConfigured && cfg.endpoint
    ? [{ name: "configured", endpoint: cfg.endpoint }]
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
  statusBarItem = undefined;
  basketService = undefined;
  annotationController = undefined;
  disposeDebugLog();
}

async function answerPrompt(args: PromptHandlerArgs): Promise<ChatAnswer> {
  const { prompt, history = [], mode = "ask", progress, requestApproval, signal } = args;
  const targets: HacklTarget[] = args.targets ?? [];
  const options = args.options ?? {};
  const createAnnotations = Boolean(options.createAnnotations);
  const startedAt = Date.now();
  progress?.({ type: "phase", text: "Preprocessing prompt..." });
  const cfg = readHacklConfig();
  const endpointApproval = await requireEndpointApproval(cfg.endpoint, cfg.endpointConfigured, requestApproval);
  if (endpointApproval) {
    return endpointApproval;
  }
  const target = await resolveChatTarget({
    endpoint: cfg.endpoint,
    endpointConfigured: cfg.endpointConfigured,
  });
  progress?.({ type: "target", endpoint: target.endpoint, model: target.model });
  const maxToolFileChars = cfg.maxToolFileChars;
  const debug = createDebugLog(cfg.debug);
  const configuredMaxContext = cfg.maxContextTokensConfigured ? cfg.maxContextTokens : undefined;
  const detectedMaxContext = configuredMaxContext === undefined
    ? await getDetectedMaxContext(target.endpoint)
    : undefined;
  const maxContextTokens = configuredMaxContext ?? detectedMaxContext ?? 32768;
  const enableThinking = cfg.enableThinking;
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
  const messages: ChatMessage[] = buildHacklMessages(prompt, contextText, history, mode, {
    targets,
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
  let createdAnnotations: HacklAnnotation[] = [];
  if (createAnnotations && annotationController) {
    const parsed = parseAnnotationsFromAnswer(answer.content, defaultUriForAnnotations(targets), { aiModel: target.model });
    const valid = filterAnnotationsForTargets(parsed.annotations, targets);
    createdAnnotations = annotationController.addBatch(valid.annotations);
    const dropped = parsed.dropped.length + valid.dropped;
    if (createdAnnotations.length > 0) {
      result.annotations = createdAnnotations;
      const dropSuffix = dropped > 0 ? ` · ${dropped} dropped` : "";
      vscode.window.setStatusBarMessage(
        `Hackl: ${createdAnnotations.length} annotation${createdAnnotations.length === 1 ? "" : "s"}${dropSuffix}`,
        3000,
      );
    } else if (parsed.blocks === 0) {
      vscode.window.setStatusBarMessage("Hackl: no hackl-annotations block in answer — showing raw answer.", 4000);
    } else if (parsed.parseErrors > 0) {
      vscode.window.setStatusBarMessage(
        `Hackl: ${parsed.parseErrors} annotation block${parsed.parseErrors === 1 ? "" : "s"} were invalid JSON — showing raw answer.`,
        5000,
      );
    } else {
      vscode.window.setStatusBarMessage(
        `Hackl: 0 annotations kept (${dropped} dropped) — showing raw answer.`,
        5000,
      );
    }
  }
  if (createAnnotations && !signal?.aborted) {
    void emitHacklSession({
      mode,
      endpoint: target.endpoint,
      model: target.model,
      targets,
      answer: answer.content,
      annotations: createdAnnotations,
    });
  }
  return result;
}

async function pruneSessionsAtStartup(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  try {
    const { pruneSessionsOnDisk } = await import("./hacklSession");
    await pruneSessionsOnDisk(root, 200);
  } catch {
    // best-effort
  }
}

async function emitHacklSession(input: {
  mode: PromptMode;
  endpoint: string;
  model: string;
  targets: HacklTarget[];
  answer: string;
  annotations: HacklAnnotation[];
}): Promise<void> {
  const session: HacklSessionRecord = {
    id: newHacklSessionId(),
    createdAt: new Date().toISOString(),
    mode: input.mode,
    endpoint: input.endpoint,
    model: input.model,
    targets: input.targets,
    answer: input.answer,
    annotations: input.annotations,
  };
  sessionFinishedEmitter?.fire(session);
  if (!readHacklConfig().persistSessions) return;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  // Fire-and-forget: do not block the next prompt on disk I/O. Errors land in status bar.
  persistHacklSession(root, session).catch((error) => {
    vscode.window.setStatusBarMessage(
      `Hackl: failed to persist session (${error instanceof Error ? error.message : String(error)})`,
      4000,
    );
  });
}

function defaultUriForAnnotations(targets: HacklTarget[]): string | undefined {
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
  const cfg = readHacklConfig();
  if (cfg.endpointConfigured && requiresNonLocalEndpointApproval(cfg.endpoint)) {
    return {
      type: "state",
      enableThinking: cfg.enableThinking,
      connected: false,
      endpoint: cfg.endpoint,
      endpointApprovalRequired: true,
    };
  }
  const probe = await tryProbe(cfg.endpoint, cfg.endpointConfigured);
  if (cfg.endpointConfigured && cfg.endpoint && !probe?.ok) {
    return {
      type: "state",
      enableThinking: cfg.enableThinking,
      endpoint: cfg.endpoint,
      endpointApprovalRequired: false,
    };
  }
  return {
    type: "state",
    enableThinking: cfg.enableThinking,
    connected: Boolean(probe?.ok),
    endpoint: probe?.endpoint,
    model: probe?.model,
    endpointApprovalRequired: false,
  };
}

async function getDetectedMaxContext(endpoint: string): Promise<number | undefined> {
  if (detectedContextCache.has(endpoint)) {
    return detectedContextCache.get(endpoint);
  }
  const detected = await detectMaxContextTokens(endpoint).catch(() => undefined);
  detectedContextCache.set(endpoint, detected);
  return detected;
}
