import * as vscode from "vscode";
import { sendChat, ChatMessage } from "./chatClient";
import { ChatPanel } from "./chatPanel";
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
  context.subscriptions.push(vscode.commands.registerCommand("hackl.chat", async () => {
    if (!chatPanel) {
      chatPanel = new ChatPanel(context, answerPrompt);
    }
    chatPanel.reveal();
  }));
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
