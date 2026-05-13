import * as vscode from "vscode";
import { ChatMessage, createOpenAICompatibleBackend } from "./chatClient";
import { ChatPanel } from "./chatPanel";
import { ApprovalRequester, ChatAnswer, PromptProgress } from "./chatSession";
import { ChatViewProvider } from "./chatView";
import { buildPromptContext, collectEditorContext } from "./context";
import { detectMaxContextTokens, resolveChatTarget } from "./localServers";
import { buildHacklMessages, ConversationMessage, PromptMode } from "./prompt";
import { completeWithTools } from "./toolLoop";
import { estimateChatTokens, formatTokenBudget } from "./tokenBudget";
import { createWorkspaceToolRunner } from "./workspaceTools";
import { createDebugLog, disposeDebugLog } from "./debugLog";

let chatPanel: ChatPanel | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
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
  extensionContext = context;
  const chatViewProvider = new ChatViewProvider(context, answerPrompt);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider),
    vscode.commands.registerCommand("hackl.chat", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.hackl");
      chatViewProvider.show();
    }),
    vscode.commands.registerCommand("hackl.chatEditor", () => {
      openChatPanel(context);
    }),
  );
}

export function deactivate(): void {
  chatPanel = undefined;
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
  const target = await resolveChatTarget({
    endpoint: config.get<string>("endpoint", ""),
    endpointConfigured: hasUserConfigured(config.inspect<string>("endpoint")),
  });
  const maxToolFileChars = config.get<number>("maxToolFileChars", 12000);
  const debug = createDebugLog(config.get<boolean>("debug", true));
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
  if (mode === "yolo") {
    await confirmYoloMode(requestApproval);
  }
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
      allowEdits: mode === "edit" || mode === "work" || mode === "agent" || mode === "yolo",
      allowSearch: mode === "work" || mode === "agent" || mode === "yolo",
      allowCommands: mode === "agent" || mode === "yolo",
      commandApproval: mode === "yolo" ? "auto" : "ask",
      requestApproval,
      signal,
    }),
    maxToolCalls: mode === "work" || mode === "agent" || mode === "yolo" ? 8 : 3,
    progress,
    debug,
    signal,
  });
  debug?.("prompt.answer", answer);
  progress?.({ type: "phase", text: `Model finished in ${Date.now() - modelStartedAt} ms` });
  return answer;
}

async function confirmYoloMode(requestApproval: ApprovalRequester | undefined): Promise<void> {
  const context = extensionContext;
  if (!context || context.globalState.get<boolean>("hackl.yoloAccepted", false)) {
    return;
  }
  const approved = await requestApproval?.({
    title: "Enable YOLO mode?",
    detail: "YOLO skips command approval prompts, but Hackl will still block destructive commands and paths outside the workspace.",
    approveLabel: "Enable YOLO",
    denyLabel: "Cancel",
  });
  if (!approved) {
    throw new Error("YOLO mode was not enabled.");
  }
  await context.globalState.update("hackl.yoloAccepted", true);
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
    chatPanel = new ChatPanel(context, answerPrompt, () => {
      chatPanel = undefined;
    });
  }
  chatPanel.reveal();
}
