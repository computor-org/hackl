import * as vscode from "vscode";
import { sendChat, ChatMessage } from "./chatClient";
import { ChatPanel } from "./chatPanel";
import { ChatViewProvider } from "./chatView";
import { buildPromptContext, collectEditorContext } from "./context";
import { resolveChatTarget } from "./localServers";
import { buildHacklMessages, ConversationMessage } from "./prompt";

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

async function answerPrompt(prompt: string, history: ConversationMessage[] = []): Promise<string> {
  const config = vscode.workspace.getConfiguration("hackl");
  const target = await resolveChatTarget({
    endpoint: config.get<string>("endpoint", ""),
    endpointConfigured: hasUserConfigured(config.inspect<string>("endpoint")),
  });
  const maxOpenFileChars = config.get<number>("maxOpenFileChars", 12000);
  const contextText = buildPromptContext(collectEditorContext(maxOpenFileChars), { maxOpenFileChars });
  const messages: ChatMessage[] = buildHacklMessages(prompt, contextText, history);
  return sendChat(messages, target);
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
