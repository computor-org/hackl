import * as vscode from "vscode";
import { ChatMessage, createOpenAICompatibleBackend } from "./chatClient";
import { ChatPanel } from "./chatPanel";
import { ApprovalRequester, ChatAnswer, ChatState, PromptProgress } from "./chatSession";
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
import { buildHacklMessages, ConversationMessage, PromptMode } from "./prompt";
import { completeWithTools } from "./toolLoop";
import { estimateChatTokens, formatTokenBudget } from "./tokenBudget";
import { createWorkspaceToolRunner } from "./workspaceTools";
import { createDebugLog, disposeDebugLog } from "./debugLog";
import { SetupViewProvider } from "./setup/setupView";

let chatPanel: ChatPanel | undefined;
let setupProvider: SetupViewProvider | undefined;
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
  setupProvider = new SetupViewProvider(context, runProbe, setEndpoint);
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBarItem.command = "hackl.openSetupGuide";
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider),
    vscode.window.registerWebviewViewProvider(SetupViewProvider.viewType, setupProvider),
    vscode.commands.registerCommand("hackl.chat", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.hackl");
      chatViewProvider.show();
      chatViewProvider.focusInput();
    }),
    vscode.commands.registerCommand("hackl.chatEditor", () => {
      openChatPanel(context);
      chatPanel?.focusInput();
    }),
    vscode.commands.registerCommand("hackl.openSetupGuide", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.hackl");
      setupProvider?.reveal();
    }),
    vscode.commands.registerCommand("hackl.checkLocalServer", async () => {
      const probe = await runProbe();
      await reportProbe(probe);
    }),
    vscode.commands.registerCommand("hackl.refreshEndpoint", async () => {
      detectedContextCache.clear();
      setupProvider?.refresh();
      const probe = await runProbe();
      await reportProbe(probe);
    }),
    vscode.commands.registerCommand("hackl.openSetupDoc", async (which: "lmstudio" | "llamacpp" | "ollama") => {
      const file = `setup-${which}.md`;
      const uri = vscode.Uri.joinPath(context.extensionUri, "docs", file);
      await vscode.commands.executeCommand("markdown.showPreview", uri);
    }),
  );

  void refreshStatus();
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
  setupProvider?.refresh();
}

export function deactivate(): void {
  chatPanel = undefined;
  setupProvider = undefined;
  statusBarItem = undefined;
  disposeDebugLog();
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

function openChatPanel(context: vscode.ExtensionContext): void {
  if (!chatPanel) {
    chatPanel = new ChatPanel(context, answerPrompt, currentChatState, () => {
      chatPanel = undefined;
    });
  }
  chatPanel.reveal();
}
