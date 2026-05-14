import * as vscode from "vscode";
import { BasketService, createReviewNoteTarget } from "./basket";
import { ReviewCommentController } from "./reviewComments";

export async function handleReviewReply(
  reply: vscode.CommentReply,
  basketService: BasketService,
  reviewController: ReviewCommentController,
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
  const target = createReviewNoteTarget({
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
  reviewController.registerHumanComment(thread, text);
}

export function handleDeleteReviewThread(
  thread: vscode.CommentThread,
  basketService: BasketService,
  reviewController: ReviewCommentController,
): void {
  const range = thread.range;
  const key = range
    ? `${thread.uri.toString()}#${range.start.line + 1}-${range.end.line + 1}`
    : undefined;
  if (key) {
    for (const target of basketService.list()) {
      const meta = target.metadata as { threadKey?: string } | undefined;
      if (meta?.threadKey === key) basketService.remove(target.id);
    }
  }
  reviewController.disposeThread(thread);
}
