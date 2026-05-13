import * as vscode from "vscode";
import { ChatMessage, createOpenAICompatibleBackend } from "./chatClient";
import { ChatPanel } from "./chatPanel";
import { ChatAnswer, PromptProgress } from "./chatSession";
import { ChatViewProvider } from "./chatView";
import { buildPromptContext, collectEditorContext } from "./context";
import { resolveChatTarget } from "./localServers";
import { buildHacklMessages, ConversationMessage } from "./prompt";
import { completeWithTools } from "./toolLoop";
import { estimateChatTokens, formatTokenBudget } from "./tokenBudget";
import { createWorkspaceToolRunner } from "./workspaceTools";

let chatPanel: ChatPanel | undefined;

interface ConfigInspection<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
  globalLanguageValue?: T;
  workspaceLanguageValue?: T;
  workspaceFolderLanguageValue?: T;
}

export function activate(context: vscode.ExtensionContext): void {
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
}

async function answerPrompt(
  prompt: string,
  history: ConversationMessage[] = [],
  progress?: (event: PromptProgress) => void,
): Promise<ChatAnswer> {
  const startedAt = Date.now();
  progress?.({ type: "phase", text: "Preprocessing prompt..." });
  const config = vscode.workspace.getConfiguration("hackl");
  const target = await resolveChatTarget({
    endpoint: config.get<string>("endpoint", ""),
    endpointConfigured: hasUserConfigured(config.inspect<string>("endpoint")),
  });
  const maxToolFileChars = config.get<number>("maxToolFileChars", 12000);
  const maxContextTokens = config.get<number>("maxContextTokens", 32768);
  const contextText = buildPromptContext(collectEditorContext(), { maxToolFileChars });
  const messages: ChatMessage[] = buildHacklMessages(prompt, contextText, history);
  const inputTokens = estimateChatTokens(messages);
  progress?.({
    type: "phase",
    text: `Preprocessing ${Date.now() - startedAt} ms · ${formatTokenBudget(inputTokens, maxContextTokens)}`,
    inputTokens,
    maxContextTokens,
  });
  progress?.({ type: "phase", text: "Model request..." });

  const modelStartedAt = Date.now();
  const answer = await completeWithTools({
    backend: createOpenAICompatibleBackend(target),
    messages,
    runTool: createWorkspaceToolRunner({ maxFileChars: maxToolFileChars }),
    maxToolCalls: 3,
    progress,
  });
  progress?.({ type: "phase", text: `Model finished in ${Date.now() - modelStartedAt} ms` });
  return answer;
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

function openChatPanel(context: vscode.ExtensionContext): void {
  if (!chatPanel) {
    chatPanel = new ChatPanel(context, answerPrompt, () => {
      chatPanel = undefined;
    });
  }
  chatPanel.reveal();
}
