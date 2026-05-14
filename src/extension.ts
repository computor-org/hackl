import * as vscode from "vscode";
import { ChatMessage, createOpenAICompatibleBackend } from "./chatClient";
import { ChatPanel } from "./chatPanel";
import { ApprovalRequester, ChatAnswer, ChatState, PromptProgress } from "./chatSession";
import { ChatViewProvider } from "./chatView";
import { buildPromptContext, collectEditorContext } from "./context";
import { detectMaxContextTokens, requiresNonLocalEndpointApproval, resolveChatTarget } from "./localServers";
import { buildHacklMessages, ConversationMessage, PromptMode } from "./prompt";
import { completeWithTools } from "./toolLoop";
import { estimateChatTokens, formatTokenBudget } from "./tokenBudget";
import { createWorkspaceToolRunner } from "./workspaceTools";
import { createDebugLog, disposeDebugLog } from "./debugLog";
import { autoStartEnabled, hasInitialSetup, ServerManager } from "./server/manager";
import { openWizard } from "./server/wizard";
import { openManagePanel } from "./server/panel";

let chatPanel: ChatPanel | undefined;
let serverManager: ServerManager | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
const detectedContextCache = new Map<string, number | undefined>();

interface ConfigInspection<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
  globalLanguageValue?: T;
  workspaceLanguageValue?: T;
  workspaceFolderLanguageValue?: T;
}

export function activate(context: vscode.ExtensionContext): void {
  const chatViewProvider = new ChatViewProvider(context, answerPrompt, currentChatState);
  serverManager = new ServerManager(context);
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBarItem.command = "hackl.localServer.manage";
  context.subscriptions.push(statusBarItem);

  const refreshStatus = async () => {
    if (!serverManager || !statusBarItem) return;
    const status = await serverManager.getStatus();
    if (status.phase === "uninitialized") {
      statusBarItem.text = "$(rocket) Hackl: set up";
      statusBarItem.tooltip = "Hackl local model not configured";
    } else if (status.phase === "ready") {
      statusBarItem.text = `$(pulse) ${status.modelDisplayName ?? "Hackl"}`;
      statusBarItem.tooltip = `Local model ready at ${status.endpoint}`;
    } else if (status.phase === "starting") {
      statusBarItem.text = "$(loading~spin) Hackl starting";
    } else if (status.phase === "error") {
      statusBarItem.text = "$(error) Hackl error";
    } else {
      statusBarItem.text = "$(circle-slash) Hackl stopped";
    }
    statusBarItem.show();
  };

  context.subscriptions.push(
    serverManager.onStatusChanged(() => { void refreshStatus(); }),
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider),
    vscode.commands.registerCommand("hackl.chat", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.hackl");
      chatViewProvider.show();
      chatViewProvider.focusInput();
    }),
    vscode.commands.registerCommand("hackl.chatEditor", () => {
      openChatPanel(context);
      chatPanel?.focusInput();
    }),
    vscode.commands.registerCommand("hackl.localServer.setup", () => {
      if (serverManager) openWizard(context, serverManager);
    }),
    vscode.commands.registerCommand("hackl.localServer.manage", () => {
      if (!serverManager) return;
      if (!hasInitialSetup(context)) {
        openWizard(context, serverManager);
      } else {
        openManagePanel(context, serverManager);
      }
    }),
    vscode.commands.registerCommand("hackl.localServer.start", async () => {
      try { await serverManager?.start(); } catch (err) { vscode.window.showErrorMessage(`Hackl: ${(err as Error).message}`); }
    }),
    vscode.commands.registerCommand("hackl.localServer.stop", async () => {
      try { await serverManager?.stop(); } catch (err) { vscode.window.showErrorMessage(`Hackl: ${(err as Error).message}`); }
    }),
    vscode.commands.registerCommand("hackl.localServer.restart", async () => {
      try { await serverManager?.restart(); } catch (err) { vscode.window.showErrorMessage(`Hackl: ${(err as Error).message}`); }
    }),
    vscode.commands.registerCommand("hackl.localServer.openLogs", () => {
      serverManager?.logChannel.show();
    }),
  );

  void firstRunPrompt(context).then(() => refreshStatus());
}

async function firstRunPrompt(context: vscode.ExtensionContext): Promise<void> {
  if (!serverManager) return;
  if (hasInitialSetup(context)) {
    if (autoStartEnabled()) {
      try { await serverManager.start(); } catch (err) { /* surface via status bar */ }
    }
    return;
  }
  const target = await resolveChatTarget({ endpoint: "", endpointConfigured: false }).catch(() => undefined);
  if (target && target.model && target.model !== "local-model") {
    return; // user has an external server running; don't nag.
  }
  const pick = await vscode.window.showInformationMessage(
    "Hackl can install llama.cpp and run a local model tuned for your hardware.",
    "Set up local model",
    "Not now",
  );
  if (pick === "Set up local model") {
    openWizard(context, serverManager);
  }
}

export async function deactivate(): Promise<void> {
  chatPanel = undefined;
  disposeDebugLog();
  if (serverManager) {
    try { await serverManager.waitForStopOnDispose(); } catch { /* best effort */ }
    serverManager = undefined;
  }
}

async function answerPrompt(
  prompt: string,
  history: ConversationMessage[] = [],
  mode: PromptMode = "ask",
  progress?: (event: PromptProgress) => void,
  requestApproval?: ApprovalRequester,
  signal?: AbortSignal,
): Promise<ChatAnswer> {
  const startedAt = Date.now();
  progress?.({ type: "phase", text: "Preprocessing prompt..." });
  const config = vscode.workspace.getConfiguration("hackl");
  const configuredEndpoint = config.get<string>("endpoint", "");
  const endpointConfigured = hasUserConfigured(config.inspect<string>("endpoint"));
  const endpointApproval = await requireEndpointApproval(configuredEndpoint, endpointConfigured, requestApproval);
  if (endpointApproval) {
    return endpointApproval;
  }
  const managed = serverManager?.managedEndpoint();
  const target = await resolveChatTarget({
    endpoint: configuredEndpoint,
    endpointConfigured,
    managedTarget: managed,
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
  });
  const contextText = buildPromptContext(collectEditorContext(), { maxToolFileChars });
  const messages: ChatMessage[] = buildHacklMessages(prompt, contextText, history, mode);
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
  const answer = await completeWithTools({
    backend: createOpenAICompatibleBackend({ ...target, enableThinking }),
    messages,
    runTool: createWorkspaceToolRunner({
      maxFileChars: maxToolFileChars,
      allowEdits: mode === "edit" || mode === "work" || mode === "agent",
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
  return answer;
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
  const managed = serverManager?.managedEndpoint();
  const target = await resolveChatTarget({ endpoint, endpointConfigured, managedTarget: managed });
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

function openChatPanel(context: vscode.ExtensionContext): void {
  if (!chatPanel) {
    chatPanel = new ChatPanel(context, answerPrompt, currentChatState, () => {
      chatPanel = undefined;
    });
  }
  chatPanel.reveal();
}
