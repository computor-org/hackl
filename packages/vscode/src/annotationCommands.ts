import * as vscode from "vscode";
import { BasketService, createAnnotationNoteTarget } from "./basket";
import { AnnotationController } from "./annotations";

export async function handleAnnotationReply(
  reply: vscode.CommentReply,
  basketService: BasketService,
  annotationController: AnnotationController,
): Promise<void> {
  const text = (reply.text ?? "").trim();
  if (!text) return;
  const thread = reply.thread;
  const range = thread.range;
  if (!range) return;
  const document = await vscode.workspace.openTextDocument(thread.uri);
  const startLineIdx = Math.max(0, Math.min(range.start.line, document.lineCount - 1));
  const endLineIdx = Math.max(startLineIdx, Math.min(range.end.line, document.lineCount - 1));
  const endLineText = document.lineAt(endLineIdx).text;
  const code = document.getText(new vscode.Range(startLineIdx, 0, endLineIdx, endLineText.length));
  const startLine = startLineIdx + 1;
  const endLine = endLineIdx + 1;
  const threadKey = `${thread.uri.toString()}#${startLine}-${endLine}`;
  const target = createAnnotationNoteTarget({
    uri: thread.uri.toString(),
    languageId: document.languageId,
    relativePath: vscode.workspace.asRelativePath(thread.uri, false),
    startLine,
    endLine,
    endCharacter: endLineText.length + 1,
    code,
    note: text,
    threadKey,
  });
  basketService.add(target);
  annotationController.registerHumanComment(thread, text);
}

export function handleDeleteAnnotationThread(
  thread: vscode.CommentThread,
  basketService: BasketService,
  annotationController: AnnotationController,
): void {
  removeBasketTargetsForThread(thread, basketService);
  annotationController.disposeThread(thread);
}

export function handleResolveAnnotationThread(
  thread: vscode.CommentThread,
  basketService: BasketService,
  annotationController: AnnotationController,
): number {
  removeBasketTargetsForThread(thread, basketService);
  return annotationController.resolveThread(thread);
}

function removeBasketTargetsForThread(thread: vscode.CommentThread, basketService: BasketService): void {
  const key = threadKey(thread);
  if (!key) return;
  for (const target of basketService.list()) {
    const meta = target.metadata as { threadKey?: string } | undefined;
    if (meta?.threadKey === key) basketService.remove(target.id);
  }
}

function threadKey(thread: vscode.CommentThread): string | undefined {
  const range = thread.range;
  if (!range) return undefined;
  return `${thread.uri.toString()}#${range.start.line + 1}-${range.end.line + 1}`;
}
