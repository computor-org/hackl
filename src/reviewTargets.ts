import * as vscode from "vscode";
import { BasketService, HacklTarget, createCurrentFileTarget, createSourceRangeTarget } from "./basket";

export type ReviewTargetsResult = HacklTarget[] | { error: string };

export async function resolveReviewTargets(basketService: BasketService): Promise<ReviewTargetsResult> {
  const existing = basketService.list();
  if (existing.length > 0) return existing;

  const editor = vscode.window.activeTextEditor;
  if (!editor) return { error: "Select code or attach context first." };

  if (!editor.selection.isEmpty) {
    const target = createSourceRangeTarget(editor);
    return target ? [target] : { error: "Could not read selection." };
  }

  const target = createCurrentFileTarget(editor);
  return target ? [target] : { error: "Could not read current file." };
}
