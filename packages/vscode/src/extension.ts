import * as vscode from "vscode";
import { ChatMessage } from "@hackl/core";
import {
  ApprovalRequester,
  BasketBridge,
  ChatAnswer,
  ChatBackendsState,
  ChatState,
  PromptHandlerArgs,
} from "./chatSession";
import { ChatViewProvider } from "./chatView";
import { BackendChoice, buildBackend, normalizeBackendChoice, pickAvailableModel } from "@hackl/core";
import { clearCodexDetectionCache, detectCodex, CodexDetection } from "@hackl/core";
import { buildPromptContext, collectEditorContext } from "./context";
import {
  detectMaxContextTokens,
  listModelIds,
  LOCAL_SERVER_CANDIDATES,
  probeAll,
  ProbeResult,
  normalizeOpenAIEndpoint,
  requiresNonLocalEndpointApproval,
  resolveChatTarget,
} from "@hackl/core";
import { shortModelLabel } from "@hackl/core";
import { buildHacklMessages, PromptMode } from "@hackl/core";
import { completeWithTools } from "@hackl/core";
import { createMcpManager, renderToolCatalog } from "@hackl/core";
import type { McpManager, ToolResult, HacklConfig as CoreHacklConfig } from "@hackl/core";
import { estimateChatTokens, formatTokenBudget } from "@hackl/core";
import { createWorkspaceToolRunner } from "./workspaceTools";
import { createDebugLog, disposeDebugLog } from "./debugLog";
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
import { filterAnnotationsForTargets, targetRevealLocation } from "@hackl/core";
import { buildLastCommitTarget, buildStagedChangesTarget } from "./gitTargets";
import { HacklSessionRecord, newHacklSessionId, persistHacklSession } from "@hackl/core";
import { handleAnnotationReply, handleDeleteAnnotationThread, handleResolveAnnotationThread } from "./annotationCommands";
import { readHacklConfig, hasUserConfigured } from "./config";
import { resolveReviewTargets } from "./reviewTargets";
import { registerAutocomplete } from "./autocomplete";
import { registerEngine } from "./enginePanel";
import { clearTrustedEndpoints, isEndpointTrusted, trustEndpoint } from "./endpointTrust";
import { classifyHacklConfigurationChange } from "./configurationChange";

let statusBarItem: vscode.StatusBarItem | undefined;
let basketService: BasketService | undefined;
let annotationController: AnnotationController | undefined;
let sessionFinishedEmitter: vscode.EventEmitter<HacklSessionRecord> | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
let activationDebug: ReturnType<typeof createDebugLog> | undefined;
const detectedContextCache = new Map<string, number | undefined>();
let connectionConfigurationWriteDepth = 0;

// MCP servers are spawned once and reused across turns; reconnected only when
// the hackl.mcp setting changes (or via the Reconnect MCP Servers command).
let mcpManager: McpManager | undefined;
let mcpSignature = "";

function enabledMcpServers(cfg: CoreHacklConfig): Record<string, unknown> {
  return Object.fromEntries(Object.entries(cfg.mcp ?? {}).filter(([, server]) => server.enabled !== false));
}

async function ensureMcpManager(
  cfg: CoreHacklConfig,
  debug: ReturnType<typeof createDebugLog> | undefined,
): Promise<McpManager | undefined> {
  const servers = enabledMcpServers(cfg);
  const signature = JSON.stringify(servers);
  if (signature === mcpSignature && mcpManager) {
    return Object.keys(servers).length ? mcpManager : undefined;
  }
  await mcpManager?.close();
  mcpManager = undefined;
  mcpSignature = signature;
  if (Object.keys(servers).length === 0) {
    return undefined;
  }
  const manager = createMcpManager({ debug });
  await manager.connectAll(servers as CoreHacklConfig["mcp"]);
  mcpManager = manager;
  return manager;
}

async function reconnectMcpManager(): Promise<void> {
  await mcpManager?.close();
  mcpManager = undefined;
  mcpSignature = "";
}

function buildMcpExtraTools(
  manager: McpManager,
  requestApproval: ((request: { title: string; detail: string; approveLabel: string; denyLabel: string }) => Promise<boolean>) | undefined,
): { names: ReadonlySet<string>; run: (name: string, args: Record<string, unknown>) => Promise<ToolResult> } {
  return {
    names: manager.toolNames(),
    run: async (name, args) => {
      const detail = `${name}\n\n${truncateArgs(args)}`;
      const approved = await requestApproval?.({ title: "Run MCP tool?", detail, approveLabel: "Run", denyLabel: "Deny" });
      if (!approved) {
        return { ok: false, content: "MCP tool call denied by user." };
      }
      return manager.callTool(name, args);
    },
  };
}

function truncateArgs(args: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(args);
    return json.length > 500 ? `${json.slice(0, 500)}...` : json;
  } catch {
    return "(unserializable arguments)";
  }
}

const API_KEY_SECRET = "hackl.apiKey";

// API keys are kept in SecretStorage, never in settings.json. Returns undefined
// when no key is stored (keyless local servers need none).
async function readApiKey(): Promise<string | undefined> {
  const value = await extensionContext?.secrets.get(API_KEY_SECRET);
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function promptForApiKey(): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: "Hackl API Key",
    prompt: "Bearer token for the configured endpoint (e.g. OpenRouter). Stored in VS Code SecretStorage.",
    password: true,
    ignoreFocusOut: true,
  });
  if (value === undefined) return;
  const trimmed = value.trim();
  if (!trimmed) {
    await extensionContext?.secrets.delete(API_KEY_SECRET);
    vscode.window.showInformationMessage("Hackl: API key cleared.");
    return;
  }
  await extensionContext?.secrets.store(API_KEY_SECRET, trimmed);
  vscode.window.showInformationMessage("Hackl: API key saved to SecretStorage.");
}

const BACKEND_CHOICE_KEY = "hackl.backendChoice";

function readBackendChoice(): BackendChoice | undefined {
  const raw = extensionContext?.globalState.get<unknown>(BACKEND_CHOICE_KEY);
  const stored = normalizeBackendChoice(raw);
  if (stored) return stored;
  const model = readGlobalCodexModel();
  return model ? { kind: "codex", model } : undefined;
}

async function writeBackendChoice(choice: BackendChoice | undefined): Promise<void> {
  await extensionContext?.globalState.update(BACKEND_CHOICE_KEY, choice);
}

function readGlobalCodexModel(): string | undefined {
  const value = vscode.workspace.getConfiguration("hackl").inspect<string>("codex.model")?.globalValue;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
  registerEngine(context);
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
      await vscode.workspace
        .getConfiguration("hackl")
        .update("model", model || "", vscode.ConfigurationTarget.Global);
    }
    await refreshStatus();
  });
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBarItem.command = "hackl.openWalkthrough";
  context.subscriptions.push(statusBarItem, basketService, annotationController, sessionFinishedEmitter);
  registerAutocomplete(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (connectionConfigurationWriteDepth > 0) return;
      const change = classifyHacklConfigurationChange(event);
      if (!change.connection) return;
      void refreshConnectionConfiguration(change, chatViewProvider);
    }),
    vscode.commands.registerCommand("hackl.chat", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.hackl");
      chatViewProvider.show();
      chatViewProvider.focusInput();
    }),
    vscode.commands.registerCommand("hackl.openWalkthrough", async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        "computor-org.hackl#hackl.connect",
        false,
      );
    }),
    vscode.commands.registerCommand("hackl.codexLogin", () => {
      const terminal = vscode.window.createTerminal({ name: "codex login" });
      terminal.show();
      terminal.sendText(`${readHacklConfig().codexCommand} login`, true);
    }),
    vscode.commands.registerCommand("hackl.selectBackend", async () => {
      await pickBackend(chatViewProvider);
    }),
    vscode.commands.registerCommand("hackl.configureConnection", async () => {
      await configurePrimaryConnection(chatViewProvider);
    }),
    vscode.commands.registerCommand("hackl.setApiKey", async () => {
      await promptForApiKey();
    }),
    vscode.commands.registerCommand("hackl.clearApiKey", async () => {
      await extensionContext?.secrets.delete(API_KEY_SECRET);
      vscode.window.showInformationMessage("Hackl: API key cleared.");
    }),
    vscode.commands.registerCommand("hackl.clearTrustedEndpoints", async () => {
      await clearTrustedEndpoints(extensionContext?.globalState);
      vscode.window.showInformationMessage("Hackl: trusted remote endpoints cleared.");
    }),
    vscode.commands.registerCommand("hackl.reconnectMcp", async () => {
      await reconnectMcpManager();
      const manager = await ensureMcpManager(readHacklConfig(), activationDebug);
      const status = manager?.status() ?? [];
      if (status.length === 0) {
        vscode.window.showInformationMessage("Hackl: no MCP servers configured (hackl.mcp).");
        return;
      }
      const summary = status
        .map((server) => `${server.name}: ${server.state}${server.state === "connected" ? ` (${server.toolCount} tools)` : ""}`)
        .join(", ");
      vscode.window.showInformationMessage(`Hackl MCP: ${summary}`);
    }),
    vscode.commands.registerCommand("hackl.checkLocalServer", async () => {
      const probe = await runProbe();
      await reportProbe(probe);
      await chatViewProvider.postState();
    }),
    vscode.commands.registerCommand("hackl.refreshEndpoint", async () => {
      detectedContextCache.clear();
      clearCodexDetectionCache();
      const probe = await runProbe();
      await reportProbe(probe);
      await chatViewProvider.postState();
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
    vscode.commands.registerCommand("hackl.addAnnotationNote", async () => {
      await vscode.commands.executeCommand("workbench.action.addComment");
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
    vscode.commands.registerCommand("hackl.dismissFocusedEmptyComment", async () => {
      // Escape on an empty draft reply: ask VS Code to hide/dispose the
      // widget. `workbench.action.hideComment` is the bound Escape command on
      // newer VS Code; we also defensively call `editor.action.cancelComment`
      // and let the comment service tear down the draft thread.
      const tried: string[] = [];
      for (const id of ["workbench.action.hideComment", "editor.action.cancelComment"]) {
        try {
          await vscode.commands.executeCommand(id);
          tried.push(id);
          break;
        } catch (error) {
          activationDebug?.("annotations.dismissOnEscape.failed", { id, error: String(error) });
        }
      }
      if (tried.length === 0) {
        activationDebug?.("annotations.dismissOnEscape.noCommandWorked");
      }
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

async function refreshConnectionConfiguration(
  change: ReturnType<typeof classifyHacklConfigurationChange>,
  view: ChatViewProvider,
): Promise<void> {
  detectedContextCache.clear();
  if (change.codexDetection) clearCodexDetectionCache();

  const cfg = readHacklConfig();
  const stored = readBackendChoice();
  if (change.localSelection && stored?.kind === "local") {
    const probed = cfg.model ? undefined : await tryProbe(cfg.endpoint, cfg.endpointConfigured);
    await writeBackendChoice({
      kind: "local",
      endpoint: cfg.endpoint || undefined,
      model: cfg.model || probed?.model || stored.model,
    });
  } else if (change.codexSelection && stored?.kind === "codex") {
    const detected = cfg.codexModel
      ? undefined
      : await detectCodex({ command: cfg.codexCommand }).catch(() => undefined);
    await writeBackendChoice({
      kind: "codex",
      model: cfg.codexModel || detected?.models[0] || stored.model,
    });
  }

  await refreshStatus();
  await view.postState();
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
  const choice = readBackendChoice();
  if (choice?.kind === "codex" && cfg.codexEnabled) {
    const codex = await detectCodex({ command: cfg.codexCommand }).catch(() => undefined);
    if (codex?.available && codex.authMode !== "none") {
      statusBarItem.text = `$(zap) Codex · ${shortModelLabel(choice.model)}`;
      statusBarItem.tooltip = `Hackl connected via codex app-server (${choice.model})`;
      statusBarItem.show();
      return;
    }
  }
  const probe = await tryProbe(cfg.endpoint, cfg.endpointConfigured);
  if (probe?.ok) {
    const chatModel = cfg.model || (choice?.kind === "local" ? choice.model : "") || probe.model;
    statusBarItem.text = `$(pulse) ${chatModel ? shortModelLabel(chatModel) : "Hackl"}`;
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
    const localModels = await listModelIds(probe.endpoint).catch(() => []);
    const models = localModels.length ? localModels : [probe.model ?? ""];
    for (const model of models) {
      items.push({
        label: `$(pulse) ${model || "Local"}`,
        description: probe.endpoint,
        detail: "Local OpenAI-compatible server",
        choice: { kind: "local", endpoint: probe.endpoint, model },
      });
    }
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
    await vscode.workspace.getConfiguration("hackl").update("model", picked.choice.model, vscode.ConfigurationTarget.Global);
  }
  await refreshStatus();
  void view.postState();
}

async function configurePrimaryConnection(view: ChatViewProvider): Promise<void> {
  const cfg = readHacklConfig();
  const enteredEndpoint = await vscode.window.showInputBox({
    title: "Hackl: Primary endpoint",
    prompt: "Enter the llama.cpp, LM Studio, Ollama, or other OpenAI-compatible server address. /v1 is optional.",
    placeHolder: "http://localhost:8080",
    value: cfg.endpoint,
    ignoreFocusOut: true,
  });
  if (enteredEndpoint === undefined) return;

  const endpoint = enteredEndpoint.trim() ? normalizeOpenAIEndpoint(enteredEndpoint) : "";
  const probe = await tryProbe(endpoint, Boolean(endpoint));
  const models = probe?.ok ? await listModelIds(probe.endpoint).catch(() => []) : [];
  let model = cfg.model;

  if (models.length > 0) {
    const choices: Array<vscode.QuickPickItem & { model?: string; manual?: boolean }> = models.map((id) => ({
      label: id,
      description: id === cfg.model ? "current" : undefined,
      model: id,
    }));
    choices.push({ label: "$(edit) Enter model ID…", manual: true });
    const picked = await vscode.window.showQuickPick(choices, {
      title: "Hackl: Primary model",
      placeHolder: "Choose a model reported by the endpoint",
      ignoreFocusOut: true,
    });
    if (!picked) return;
    if (picked.manual) {
      const enteredModel = await promptForPrimaryModel(cfg.model);
      if (enteredModel === undefined) return;
      model = enteredModel;
    } else {
      model = picked.model ?? "";
    }
  } else {
    const enteredModel = await promptForPrimaryModel(cfg.model);
    if (enteredModel === undefined) return;
    model = enteredModel;
  }

  const settings = vscode.workspace.getConfiguration("hackl");
  connectionConfigurationWriteDepth += 1;
  try {
    await settings.update("endpoint", endpoint, vscode.ConfigurationTarget.Global);
    await settings.update("model", model, vscode.ConfigurationTarget.Global);
  } finally {
    connectionConfigurationWriteDepth -= 1;
  }
  await writeBackendChoice(model
    ? { kind: "local", endpoint: probe?.endpoint ?? (endpoint || undefined), model }
    : undefined);
  await refreshStatus();
  await view.postState();

  if (probe?.ok) {
    vscode.window.showInformationMessage(`Hackl: connected to ${probe.endpoint} (${model || probe.model || "auto model"}).`);
  } else {
    vscode.window.showInformationMessage("Hackl: connection saved. Start the server and Hackl will reconnect automatically.");
  }
}

function promptForPrimaryModel(current: string): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    title: "Hackl: Primary model",
    prompt: "Enter the model ID, or leave empty to use the first model reported by the server.",
    placeHolder: "qwen",
    value: current,
    ignoreFocusOut: true,
  }).then((value) => value === undefined ? undefined : value.trim());
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
      "Open walkthrough",
    );
    if (choice === "Open walkthrough") {
      await vscode.commands.executeCommand("hackl.openWalkthrough");
    }
  }
  await refreshStatus();
}

export function deactivate(): void {
  statusBarItem = undefined;
  basketService = undefined;
  annotationController = undefined;
  void mcpManager?.close();
  mcpManager = undefined;
  mcpSignature = "";
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
    const model = pickAvailableModel(codexDetection.models, stored?.model ?? readGlobalCodexModel());
    if (!model) {
      return { content: "Codex is installed but no Codex models are available." };
    }
    target = { endpoint: "codex", model };
  } else {
    const preferredModel = cfg.model || (stored?.kind === "local" ? stored.model : "");
    target = await resolveChatTarget({
      endpoint: cfg.endpoint,
      endpointConfigured: cfg.endpointConfigured,
      preferredModel,
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
  const reasoningBudget = cfg.reasoningBudget;
  debug?.("prompt.start", {
    mode,
    endpoint: target.endpoint,
    model: target.model,
    maxToolFileChars,
    enableThinking,
    reasoningBudget,
    targets: targets.length,
    createAnnotations,
  });
  const contextText = buildPromptContext(collectEditorContext(), { maxToolFileChars });
  const mcp = await ensureMcpManager(cfg, debug);
  const mcpTools = mcp?.tools() ?? [];
  const messages: ChatMessage[] = buildHacklMessages(prompt, contextText, history, mode, {
    targets,
    createAnnotations,
    toolCatalog: renderToolCatalog(mcpTools),
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
  const allowEdits = mode === "edit" || mode === "work" || mode === "agent" || mode === "yolo";
  const choiceForCall: BackendChoice = useCodex
    ? { kind: "codex", model: target.model }
    : { kind: "local", endpoint: target.endpoint, model: target.model };
  const apiKey = useCodex ? undefined : await readApiKey();
  const answer = await completeWithTools({
    backend: buildBackend({
      choice: choiceForCall,
      enableThinking,
      reasoningBudget,
      apiKey,
      codexCommand,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      clientVersion: extensionContext?.extension.packageJSON?.version,
    }),
    messages,
    runTool: createWorkspaceToolRunner({
      maxFileChars: maxToolFileChars,
      allowEdits,
      allowSearch: mode === "work" || mode === "agent" || mode === "yolo",
      allowCommands: mode === "agent" || mode === "yolo",
      yolo: mode === "yolo",
      requestApproval,
      signal,
    }),
    extraTools: mcp && mcpTools.length ? buildMcpExtraTools(mcp, requestApproval) : undefined,
    maxToolCalls: cfg.maxToolCalls,
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
    const { pruneSessionsOnDisk } = await import("@hackl/core");
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

async function requireEndpointApproval(
  endpoint: string,
  endpointConfigured: boolean,
  requestApproval?: ApprovalRequester,
): Promise<ChatAnswer | undefined> {
  if (!endpointConfigured || !requiresNonLocalEndpointApproval(endpoint)) {
    return undefined;
  }
  if (isEndpointTrusted(extensionContext?.globalState, endpoint)) {
    return undefined;
  }
  const approved = await requestApproval?.({
    title: "Trust non-local endpoint?",
    detail: `Hackl is configured to send prompts and selected context to ${endpoint.trim()}. Trust this exact endpoint for future requests?`,
    approveLabel: "Trust endpoint",
    denyLabel: "Cancel",
  }) ?? false;
  if (approved) {
    await trustEndpoint(extensionContext?.globalState, endpoint);
  }
  return approved
    ? undefined
    : { content: "Request cancelled because hackl.endpoint is configured to a non-local endpoint." };
}

async function currentChatState(): Promise<ChatState> {
  const cfg = readHacklConfig();
  const codex = cfg.codexEnabled
    ? await detectCodex({ command: cfg.codexCommand }).catch(() => undefined)
    : undefined;
  // Probe the configured endpoint even when it is non-local: a /models probe
  // sends no user content, and the send-time approval gate below remains the
  // privacy boundary. Skipping the probe here made a reachable non-local
  // endpoint render as "Not reachable" and silently fall back to codex.
  const probe = await tryProbe(cfg.endpoint, cfg.endpointConfigured);
  const localModels = probe?.ok ? await listModelIds(probe.endpoint).catch(() => []) : [];
  const choice = effectiveBackendChoice(probe, codex, cfg.model);
  const backends = buildBackendsState(choice, probe, codex, localModels);
  const base: ChatState = {
    type: "state",
    enableThinking: cfg.enableThinking,
    backends,
  };
  if (cfg.endpointConfigured
    && requiresNonLocalEndpointApproval(cfg.endpoint)
    && !isEndpointTrusted(extensionContext?.globalState, cfg.endpoint)) {
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
    model: choice.kind === "local" ? choice.model || probe?.model : probe?.model,
    endpointApprovalRequired: false,
  };
}

function effectiveBackendChoice(
  probe: ProbeResult | undefined,
  codex: CodexDetection | undefined,
  configuredModel: string,
): BackendChoice {
  const stored = readBackendChoice();
  if (stored?.kind === "codex" && codex?.available && codex.authMode !== "none") {
    const model = pickAvailableModel(codex.models, stored.model);
    if (model) return { kind: "codex", model };
  }
  if (stored?.kind === "local") {
    return {
      kind: "local",
      model: configuredModel || stored.model || probe?.model || "",
      endpoint: stored.endpoint ?? probe?.endpoint,
    };
  }
  if (probe?.ok) {
    return { kind: "local", model: configuredModel || probe.model || "", endpoint: probe.endpoint };
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
  localModels: string[],
): ChatBackendsState {
  return {
    local: {
      available: Boolean(probe?.ok),
      endpoint: probe?.endpoint,
      model: current.kind === "local" ? current.model || probe?.model : probe?.model,
      models: localModels,
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
