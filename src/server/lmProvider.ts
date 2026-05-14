import * as vscode from "vscode";
import { createOpenAICompatibleBackend, ChatMessage } from "../chatClient";
import { findModel } from "./catalog";
import { ServerManager } from "./manager";

export const HACKL_LM_VENDOR = "hackl";

export function registerLanguageModelProvider(manager: ServerManager): vscode.Disposable {
  const onDidChange = new vscode.EventEmitter<void>();
  const sub = manager.onStatusChanged(() => onDidChange.fire());
  const provider: vscode.LanguageModelChatProvider = {
    onDidChangeLanguageModelChatInformation: onDidChange.event,

    async provideLanguageModelChatInformation(): Promise<vscode.LanguageModelChatInformation[]> {
      const status = await manager.getStatus();
      if (status.phase !== "ready" || !status.modelId || !status.endpoint) return [];
      const entry = findModel(status.modelId);
      if (!entry) return [];
      const ctx = status.actualCtxSize ?? entry.recommendedCtx;
      return [{
        id: entry.id,
        name: entry.displayName,
        family: "llama-local",
        version: entry.quant,
        detail: "Hackl local llama.cpp",
        maxInputTokens: Math.max(1024, ctx - 1024),
        maxOutputTokens: 4096,
        capabilities: { toolCalling: false, imageInput: false },
      }];
    },

    async provideLanguageModelChatResponse(
      _model,
      messages,
      _options,
      progress,
      token,
    ): Promise<void> {
      const managed = manager.managedEndpoint();
      if (!managed) throw new Error("Hackl local server is not running.");
      const openAiMessages = messages.map(toOpenAi);
      const backend = createOpenAICompatibleBackend({ endpoint: managed.endpoint, model: managed.model });
      const ac = new AbortController();
      const cancelSub = token.onCancellationRequested(() => ac.abort());
      try {
        await backend.complete(openAiMessages, {
          signal: ac.signal,
          onDelta: (delta) => {
            if (delta.type === "answer") {
              progress.report(new vscode.LanguageModelTextPart(delta.text));
            }
          },
        });
      } finally {
        cancelSub.dispose();
      }
    },

    async provideTokenCount(_model, text): Promise<number> {
      const s = typeof text === "string" ? text : extractText(text);
      // Rough 4-chars-per-token heuristic; sufficient for budget UI.
      return Math.ceil(s.length / 4);
    },
  };
  const reg = vscode.lm.registerLanguageModelChatProvider(HACKL_LM_VENDOR, provider);
  return new vscode.Disposable(() => { sub.dispose(); onDidChange.dispose(); reg.dispose(); });
}

function toOpenAi(msg: vscode.LanguageModelChatRequestMessage): ChatMessage {
  const role: ChatMessage["role"] =
    msg.role === vscode.LanguageModelChatMessageRole.User ? "user"
    : msg.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant"
    : "system";
  return { role, content: extractText(msg) };
}

function extractText(msg: vscode.LanguageModelChatRequestMessage): string {
  const parts: string[] = [];
  for (const part of msg.content) {
    if (part instanceof vscode.LanguageModelTextPart) parts.push(part.value);
  }
  return parts.join("");
}
