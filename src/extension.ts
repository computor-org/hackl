import * as vscode from "vscode";
import { ChatMessage } from "./chatClient";
import {
  ApprovalRequester,
  BasketBridge,
  ChatAnswer,
  ChatBackendsState,
  ChatState,
  PromptHandlerArgs,
} from "./chatSession";
import { ChatViewProvider } from "./chatView";
import { BackendChoice, buildBackend, normalizeBackendChoice } from "./backendRegistry";
import { clearCodexDetectionCache, detectCodex, CodexDetection } from "./codexDetect";
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
  createCurrentFileTarget,
  createSourceRangeTarget,
  describeTarget,
} from "./basket";
import { HacklAnnotation, AnnotationController, parseAnnotationsFromAnswer } from "./annotations";
import { filterAnnotationsForTargets, targetRevealLocation } from "./targetResolve";
import { buildLastCommitTarget, buildStagedChangesTarget } from "./gitTargets";
import { HacklSessionRecord, newHacklSessionId, persistHacklSession } from "./hacklSession";
import { handleAnnotationReply, handleDeleteAnnotationThread, handleResolveAnnotationThread } from "./annotationCommands";
import { readHacklConfig, hasUserConfigured } from "./config";
import { resolveReviewTargets } from "./reviewTargets";

let statusBarItem: vscode.StatusBarItem | undefined;
let basketService: BasketService | undefined;
let annotationController: AnnotationController | undefined;
let sessionFinishedEmitter: vscode.EventEmitter<HacklSessionRecord> | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
let activationDebug: ReturnType<typeof createDebugLog> | undefined;
const detectedContextCache = new Map<string, number | undefined>();

const BACKEND_CHOICE_KEY = "hackl.backendChoice";
const SETUP_HINT_DISMISSED_KEY = "hackl.setupHintDismissed";

function readBackendChoice(): BackendChoice | undefined {
  const raw = extensionContext?.globalState.get<unknown>(BACKEND_CHOICE_KEY);
  return normalizeBackendChoice(raw);
}

async function writeBackendChoice(choice: BackendChoice | undefined): Promise<void> {
  await extensionContext?.globalState.update(BACKEND_CHOICE_KEY, choice);
}

function isSetupHintDismissed(): boolean {
  return Boolean(extensionContext?.globalState.get<boolean>(SETUP_HINT_DISMISSED_KEY, false));
}

export async function dismissSetupHint(value: boolean): Promise<void> {
  await extensionContext?.globalState.update(SETUP_HINT_DISMISSED_KEY, value);
}

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
  extensionContext = context;
  activationDebug = createDebugLog(readHacklConfig().debug);
  activationDebug?.("extension.activate", {
    activationEvents: context.extension.packageJSON?.activationEvents,
    activeEditor: vscode.window.activeTextEditor?.document.uri.toString(),
    visibleEditors: vscode.window.visibleTextEditors.map((editor) => editor.document.uri.toString()),
  });
  basketService = new BasketService();
  annotationController = new AnnotationController();
  annotationController.setDebugLog(activationDebug);
  sessionFinishedEmitter = new vscode.EventEmitter<HacklSessionRecord>();
  const basketBridge = makeBasketBridge(basketService);

  const chatViewProvider = new ChatViewProvider(
    context,
    answerPrompt,
    currentChatState,
    basketBridge,
    () => resolveReviewTargets(basketService!),
  );
  chatViewProvider.setBackendSetter(async (kind, model) => {
    if (kind === "codex") {
      if (!model) return;
      await writeBackendChoice({ kind: "codex", model });
      await vscode.workspace
        .getConfiguration("hackl")
        .update("codex.model", model, vscode.ConfigurationTarget.Global);
    } else {
      const cfg = readHacklConfig();
      const endpoint = cfg.endpoint || undefined;
      await writeBackendChoice({ kind: "local", model: model || "", endpoint });
    }
    await refreshStatus();
  });
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBarItem.command = "hackl.openSetupGuide";
  context.subscriptions.push(statusBarItem, basketService, annotationController, sessionFinishedEmitter);
  scheduleAnnotationRangeRefreshes(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider),
    vscode.commands.registerCommand("hackl.chat", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.hackl");
      chatViewProvider.show();
      chatViewProvider.focusInput();
    }),
    vscode.commands.registerCommand("hackl.openSetupGuide", () => {
      SetupPanel.show(context, runProbe, setEndpoint, {
        detectCodex: () => detectCodex({ command: readHacklConfig().codexCommand }),
        useCodex: async (model) => {
          await writeBackendChoice({ kind: "codex", model });
          await vscode.workspace.getConfiguration("hackl").update("codex.model", model, vscode.ConfigurationTarget.Global);
          await refreshStatus();
          void chatViewProvider.postState();
        },
        codexLogin: async () => {
          const terminal = vscode.window.createTerminal({ name: "codex login" });
          terminal.show();
          terminal.sendText(`${readHacklConfig().codexCommand} login`, true);
        },
        isHintDismissed: () => isSetupHintDismissed(),
        setHintDismissed: (value) => dismissSetupHint(value),
      });
    }),
    vscode.commands.registerCommand("hackl.selectBackend", async () => {
      await pickBackend(chatViewProvider);
    }),
    vscode.commands.registerCommand("hackl.dismissSetupHint", async () => {
      await dismissSetupHint(true);
      await refreshStatus();
      void chatViewProvider.postState();
    }),
    vscode.commands.registerCommand("hackl.showSetupHint", async () => {
      await dismissSetupHint(false);
      await refreshStatus();
      void chatViewProvider.postState();
    }),
    vscode.commands.registerCommand("hackl.checkLocalServer", async () => {
      const probe = await runProbe();
      await reportProbe(probe);
    }),
    vscode.commands.registerCommand("hackl.refreshEndpoint", async () => {
      detectedContextCache.clear();
      clearCodexDetectionCache();
      SetupPanel.refresh();
      const probe = await runProbe();
      await reportProbe(probe);
    }),
    vscode.commands.registerCommand("hackl.traceAnnotationRanges", async () => {
      activationDebug = createDebugLog(true);
      annotationController?.setDebugLog(activationDebug);
      activationDebug?.("annotations.traceCommand", {
        activeEditor: vscode.window.activeTextEditor?.document.uri.toString(),
        visibleEditors: vscode.window.visibleTextEditors.map((editor) => editor.document.uri.toString()),
        openDocuments: vscode.workspace.textDocuments.map((document) => document.uri.toString()),
      });
      annotationController?.refreshCommentingRanges();
      await vscode.commands.executeCommand("workbench.action.toggleCommenting");
      await vscode.commands.executeCommand("workbench.action.toggleCommenting");
      vscode.window.setStatusBarMessage("Hackl: refreshed annotation ranges; see Hackl Debug output.", 4000);
    }),
    vscode.commands.registerCommand("hackl.openSetupDoc", async (which: "lmstudio" | "llamacpp" | "ollama") => {
      const file = `setup-${which}.md`;
      const uri = vscode.Uri.joinPath(context.extensionUri, "docs", file);
      await vscode.commands.executeCommand("markdown.showPreview", uri);
    }),
    vscode.commands.registerCommand("hackl.attachContext", async () => {
      const picked = await vscode.window.showQuickPick(
        [
          { label: "Selection", command: "hackl.addSelectionToContext" },
          { label: "Current file", command: "hackl.addCurrentFileToContext" },
          { label: "Staged changes", command: "hackl.addStagedChangesToContext" },
          { label: "Last commit", command: "hackl.addLastCommitToContext" },
          { label: "Markdown section", command: "hackl.addMarkdownSectionToContext" },
        ],
        { title: "Attach context", placeHolder: "Choose what Hackl should include" },
      );
      if (picked) await vscode.commands.executeCommand(picked.command);
    }),
    vscode.commands.registerCommand("hackl.replyToAnnotationThread", async (reply: vscode.CommentReply) => {
      if (!basketService || !annotationController) return;
      await handleAnnotationReply(reply, basketService, annotationController);
      await vscode.commands.executeCommand("hackl.chat");
      chatViewProvider.notifyStatus(
        `Reply attached to context from ${vscode.workspace.asRelativePath(reply.thread.uri, false)}:${(reply.thread.range?.start.line ?? 0) + 1}`,
      );
    }),
    vscode.commands.registerCommand("hackl.deleteAnnotationThread", (thread: vscode.CommentThread) => {
      if (!basketService || !annotationController) return;
      handleDeleteAnnotationThread(thread, basketService, annotationController);
    }),
    vscode.commands.registerCommand("hackl.resolveAnnotationThread", (thread: vscode.CommentThread) => {
      if (!basketService || !annotationController) return;
      const n = handleResolveAnnotationThread(thread, basketService, annotationController);
      vscode.window.setStatusBarMessage(
        n > 0 ? `Hackl: resolved annotation thread` : "Hackl: annotation thread already resolved",
        2000,
      );
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
    vscode.commands.registerCommand("hackl.addCurrentFileToContext", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("Hackl: open a file first.");
        return;
      }
      const target = createCurrentFileTarget(editor);
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
      await vscode.commands.executeCommand("hackl.chat");
      chatViewProvider.setPromptText("/review");
      chatViewProvider.notifyStatus("/review: staged changes plus attached context, else current file.");
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

function scheduleAnnotationRangeRefreshes(context: vscode.ExtensionContext): void {
  // Two startup heartbeats: one immediately so the provider is registered as
  // soon as the comments controller spins up, and one after a short delay to
  // catch the case where other extensions register their own comment
  // controllers right after activation and would otherwise crowd ours out.
  // Subsequent recompute is driven by editor events (below) with throttling
  // inside AnnotationController.refreshCommentingRanges.
  for (const delay of [0, 1500]) {
    const timer = setTimeout(() => {
      activationDebug?.("annotations.scheduledRefresh", { delay });
      annotationController?.refreshCommentingRanges();
    }, delay);
    context.subscriptions.push({ dispose: () => clearTimeout(timer) });
  }
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      activationDebug?.("annotations.activeEditorChanged", { uri: editor?.document.uri.toString() });
      refreshAnnotationRangesForDocument(editor?.document);
    }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      activationDebug?.("annotations.visibleEditorsChanged", { uris: editors.map((editor) => editor.document.uri.toString()) });
      if (editors.some((editor) => isEditorDocument(editor.document))) {
        annotationController?.refreshCommentingRanges();
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      activationDebug?.("annotations.documentOpened", { uri: document.uri.toString(), languageId: document.languageId });
      refreshAnnotationRangesForDocument(document);
    }),
  );
}

function refreshAnnotationRangesForDocument(document: vscode.TextDocument | undefined): void {
  if (!isEditorDocument(document)) return;
  annotationController?.refreshCommentingRanges();
}

function isEditorDocument(document: vscode.TextDocument | undefined): boolean {
  const scheme = document?.uri.scheme;
  return scheme === "file" || scheme === "untitled" || scheme === "vscode-remote";
}

async function refreshStatus(): Promise<void> {
  if (!statusBarItem) return;
  const cfg = readHacklConfig();
  const choice = readBackendChoice();
  if (choice?.kind === "codex" && cfg.codexEnabled) {
    const codex = await detectCodex({ command: cfg.codexCommand }).catch(() => undefined);
    if (codex?.available && codex.authMode !== "none") {
      statusBarItem.text = `$(zap) Codex · ${choice.model}`;
      statusBarItem.tooltip = `Hackl connected via codex app-server (${choice.model})`;
      statusBarItem.show();
      return;
    }
  }
  const probe = await tryProbe(cfg.endpoint, cfg.endpointConfigured);
  if (probe?.ok) {
    statusBarItem.text = `$(pulse) ${probe.model ?? "Hackl"}`;
    statusBarItem.tooltip = `Hackl connected to ${probe.endpoint}`;
  } else {
    statusBarItem.text = "$(plug) Hackl: connect";
    statusBarItem.tooltip = "No model detected. Click for setup help.";
  }
  statusBarItem.show();
}

async function pickBackend(view: ChatViewProvider): Promise<void> {
  const cfg = readHacklConfig();
  const items: Array<vscode.QuickPickItem & { choice: BackendChoice }> = [];
  const probe = await tryProbe(cfg.endpoint, cfg.endpointConfigured);
  if (probe?.ok) {
    items.push({
      label: `$(pulse) ${probe.model ?? "Local"}`,
      description: probe.endpoint,
      detail: "Local OpenAI-compatible server",
      choice: { kind: "local", endpoint: probe.endpoint, model: probe.model ?? "" },
    });
  }
  if (cfg.codexEnabled) {
    const codex = await detectCodex({ command: cfg.codexCommand }).catch(() => undefined);
    if (codex?.available && codex.authMode !== "none") {
      for (const model of codex.models) {
        items.push({
          label: `$(zap) ${model}`,
          description: "Codex",
          detail: `codex app-server · ${codex.authMode === "chatgpt" ? "ChatGPT login" : "API key"}`,
          choice: { kind: "codex", model },
        });
      }
    }
  }
  if (items.length === 0) {
    vscode.window.showInformationMessage("Hackl: no backend available. Open the setup guide to configure one.");
    return;
  }
  const picked = await vscode.window.showQuickPick(items, { title: "Hackl backend", placeHolder: "Choose backend and model" });
  if (!picked) return;
  if (picked.choice.kind === "codex") {
    await writeBackendChoice(picked.choice);
    await vscode.workspace.getConfiguration("hackl").update("codex.model", picked.choice.model, vscode.ConfigurationTarget.Global);
  } else {
    await writeBackendChoice(picked.choice);
  }
  await refreshStatus();
  void view.postState();
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
  const stored = readBackendChoice();
  const useCodex = stored?.kind === "codex" && cfg.codexEnabled;
  let codexCommand = cfg.codexCommand;
  let codexDetection: CodexDetection | undefined;
  let target: { endpoint: string; model: string };
  if (useCodex) {
    codexDetection = await detectCodex({ command: cfg.codexCommand });
    if (!codexDetection.available) {
      return { content: `Codex is not available: ${codexDetection.error ?? "command not found"}` };
    }
    if (codexDetection.authMode === "none") {
      return { content: "Codex is installed but not logged in. Run `codex login`, then try again." };
    }
    codexCommand = codexDetection.command;
    target = { endpoint: "codex", model: stored!.model };
  } else {
    target = await resolveChatTarget({
      endpoint: cfg.endpoint,
      endpointConfigured: cfg.endpointConfigured,
    });
  }
  progress?.({ type: "target", endpoint: target.endpoint, model: target.model });
  const maxToolFileChars = cfg.maxToolFileChars;
  const debug = createDebugLog(cfg.debug);
  const configuredMaxContext = cfg.maxContextTokensConfigured ? cfg.maxContextTokens : undefined;
  const codexMaxContext = useCodex ? codexDetection?.modelContextWindows[target.model] : undefined;
  const detectedMaxContext = configuredMaxContext === undefined && !useCodex
    ? await getDetectedMaxContext(target.endpoint)
    : undefined;
  const maxContextTokens = configuredMaxContext ?? codexMaxContext ?? detectedMaxContext ?? 32768;
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
  const choiceForCall: BackendChoice = useCodex
    ? { kind: "codex", model: target.model }
    : { kind: "local", endpoint: target.endpoint, model: target.model };
  const answer = await completeWithTools({
    backend: buildBackend({
      choice: choiceForCall,
      enableThinking,
      codexCommand,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      clientVersion: extensionContext?.extension.packageJSON?.version,
    }),
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
      void annotationController.focusThreadReply(createdAnnotations[0].id);
    } else if (parsed.blocks === 0 || parsed.parseErrors > 0) {
      vscode.window.setStatusBarMessage("Hackl could not create annotations. Showing the raw answer.", 5000);
    } else {
      vscode.window.setStatusBarMessage("No annotations created.", 4000);
    }
  }
  if (createAnnotations && !signal?.aborted) {
    void emitHacklSession({
      mode,
      endpoint: target.endpoint,
      model: target.model,
      backendKind: useCodex ? "codex" : "local",
      targets,
      answer: answer.content,
      annotations: createdAnnotations,
    });
  }
  return result;
}

async function pruneSessionsAtStartup(): Promise<void> {
  const root = extensionContext?.globalStorageUri.fsPath;
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
  backendKind: "local" | "codex";
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
    backendKind: input.backendKind,
    targets: input.targets,
    answer: input.answer,
    annotations: input.annotations,
  };
  sessionFinishedEmitter?.fire(session);
  if (!readHacklConfig().persistSessions) return;
  const root = extensionContext?.globalStorageUri.fsPath;
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
  const codex = cfg.codexEnabled
    ? await detectCodex({ command: cfg.codexCommand }).catch(() => undefined)
    : undefined;
  const probe = (!cfg.endpointConfigured || !requiresNonLocalEndpointApproval(cfg.endpoint))
    ? await tryProbe(cfg.endpoint, cfg.endpointConfigured)
    : undefined;
  const choice = effectiveBackendChoice(probe, codex);
  const backends = buildBackendsState(choice, probe, codex);
  const base: ChatState = {
    type: "state",
    enableThinking: cfg.enableThinking,
    backends,
  };
  if (cfg.endpointConfigured && requiresNonLocalEndpointApproval(cfg.endpoint)) {
    return { ...base, connected: false, endpoint: cfg.endpoint, endpointApprovalRequired: true };
  }
  if (choice.kind === "codex" && backends.codex.available && !backends.codex.needsLogin) {
    return { ...base, connected: true, endpoint: "codex", model: choice.model, endpointApprovalRequired: false };
  }
  if (cfg.endpointConfigured && cfg.endpoint && !probe?.ok) {
    return { ...base, endpoint: cfg.endpoint, endpointApprovalRequired: false };
  }
  return {
    ...base,
    connected: Boolean(probe?.ok),
    endpoint: probe?.endpoint,
    model: probe?.model,
    endpointApprovalRequired: false,
  };
}

function effectiveBackendChoice(
  probe: ProbeResult | undefined,
  codex: CodexDetection | undefined,
): BackendChoice {
  const stored = readBackendChoice();
  if (stored?.kind === "codex" && codex?.available && codex.authMode !== "none") {
    return stored;
  }
  if (stored?.kind === "local") {
    return { kind: "local", model: stored.model || probe?.model || "", endpoint: stored.endpoint ?? probe?.endpoint };
  }
  if (probe?.ok) {
    return { kind: "local", model: probe.model ?? "", endpoint: probe.endpoint };
  }
  if (codex?.available && codex.authMode !== "none" && codex.models.length > 0) {
    return { kind: "codex", model: codex.models[0] };
  }
  return { kind: "local", model: "", endpoint: probe?.endpoint };
}

function buildBackendsState(
  current: BackendChoice,
  probe: ProbeResult | undefined,
  codex: CodexDetection | undefined,
): ChatBackendsState {
  return {
    local: {
      available: Boolean(probe?.ok),
      endpoint: probe?.endpoint,
      model: probe?.model,
    },
    codex: {
      available: Boolean(codex?.available),
      models: codex?.models ?? [],
      authMode: codex?.authMode ?? "none",
      needsLogin: Boolean(codex?.available && codex.authMode === "none"),
    },
    current: { kind: current.kind, model: current.model || undefined },
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
