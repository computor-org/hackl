import type { ExtensionContext } from "vscode";
import { getVscode } from "./vscodeShim";

export const API_KEY_SECRET = "hackl.apiKey";

export async function readApiKey(context?: ExtensionContext): Promise<string | undefined> {
  const value = await context?.secrets.get(API_KEY_SECRET);
  return value?.trim() || undefined;
}

export async function promptForApiKey(context?: ExtensionContext): Promise<void> {
  const vscode = getVscode();
  const value = await vscode.window.showInputBox({
    title: "Hackl API Key",
    prompt: "Bearer token for your endpoint. Stored in VS Code SecretStorage.",
    password: true, ignoreFocusOut: true,
  });
  if (value === undefined) return;
  const trimmed = value.trim();
  if (!trimmed) {
    await context?.secrets.delete(API_KEY_SECRET);
    void vscode.window.showInformationMessage("Hackl: API key cleared.");
  } else {
    await context?.secrets.store(API_KEY_SECRET, trimmed);
    void vscode.window.showInformationMessage("Hackl: API key saved to SecretStorage.");
  }
}
