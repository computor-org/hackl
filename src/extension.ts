import * as vscode from "vscode";
import { sendChat, ChatMessage } from "./chatClient";
import { ChatPanel } from "./chatPanel";
import { buildPromptContext, collectEditorContext } from "./context";

let chatPanel: ChatPanel | undefined;

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

async function answerPrompt(prompt: string): Promise<string> {
  const config = vscode.workspace.getConfiguration("hackl");
  const endpoint = config.get<string>("endpoint", "http://localhost:8080/v1");
  const model = config.get<string>("model", "qwen");
  const maxOpenFileChars = config.get<number>("maxOpenFileChars", 12000);
  const contextText = buildPromptContext(collectEditorContext(maxOpenFileChars), { maxOpenFileChars });
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are Hackl, a local-first coding assistant.",
        "Answer using the supplied editor context.",
        "Do not claim to edit files. Suggest changes in prose or code blocks only.",
        "Assume Git is the review and history layer.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `Editor context:\n\n${contextText || "[No open editor context]"}\n\nUser request:\n\n${prompt}`,
    },
  ];
  return sendChat(messages, { endpoint, model });
}
