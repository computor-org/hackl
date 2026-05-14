import type * as vscodeTypes from "vscode";

export type ReviewSeverity = "note" | "suggestion" | "warning" | "blocking";
export type ReviewStatus = "open" | "resolved" | "dismissed";

export interface HacklReviewComment {
  id: string;
  uri: string;
  startLine: number;
  endLine: number;
  severity: ReviewSeverity;
  message: string;
  rationale?: string;
  status: ReviewStatus;
  authorType: "human" | "ai";
  aiModel?: string;
  createdAt: number;
}

let counter = 0;

interface ThreadEntry {
  thread: vscodeTypes.CommentThread;
  comment: HacklReviewComment;
}

export class ReviewCommentController {
  private controller: vscodeTypes.CommentController;
  private readonly threads = new Map<string, ThreadEntry>();
  private readonly vscode: typeof vscodeTypes;

  constructor() {
    this.vscode = require("vscode") as typeof vscodeTypes;
    this.controller = this.vscode.comments.createCommentController("hackl.review", "Hackl Review");
    const VscRange = this.vscode.Range;
    this.controller.commentingRangeProvider = {
      provideCommentingRanges(document: vscodeTypes.TextDocument): vscodeTypes.Range[] {
        return [new VscRange(0, 0, Math.max(0, document.lineCount - 1), 0)];
      },
    };
  }

  list(): HacklReviewComment[] {
    return Array.from(this.threads.values()).map((entry) => entry.comment);
  }

  add(input: Omit<HacklReviewComment, "id" | "status" | "createdAt"> & { status?: ReviewStatus; createdAt?: number }): HacklReviewComment {
    counter += 1;
    const id = `rev-${Date.now().toString(36)}-${counter.toString(36)}`;
    const comment: HacklReviewComment = {
      id,
      status: input.status ?? "open",
      uri: input.uri,
      startLine: input.startLine,
      endLine: input.endLine,
      severity: input.severity,
      message: input.message,
      rationale: input.rationale,
      authorType: input.authorType,
      aiModel: input.aiModel,
      createdAt: input.createdAt ?? Date.now(),
    };
    const uri = this.vscode.Uri.parse(comment.uri);
    const range = new this.vscode.Range(
      Math.max(0, comment.startLine - 1),
      0,
      Math.max(0, comment.endLine - 1),
      0,
    );
    const thread = this.controller.createCommentThread(uri, range, []);
    thread.label = `Hackl · ${comment.severity}`;
    thread.collapsibleState = this.vscode.CommentThreadCollapsibleState.Expanded;
    thread.canReply = false;
    const body = new this.vscode.MarkdownString(formatBody(comment));
    body.isTrusted = false;
    const vscodeComment: vscodeTypes.Comment = {
      body,
      mode: this.vscode.CommentMode.Preview,
      author: { name: `Hackl (${comment.severity})` },
      contextValue: `hackl:${comment.id}`,
    };
    thread.comments = [vscodeComment];
    this.threads.set(id, { thread, comment });
    return comment;
  }

  resolve(id: string): void {
    const entry = this.threads.get(id);
    if (!entry) return;
    entry.comment.status = "resolved";
    entry.thread.dispose();
    this.threads.delete(id);
  }

  dismiss(id: string): void {
    const entry = this.threads.get(id);
    if (!entry) return;
    entry.comment.status = "dismissed";
    entry.thread.dispose();
    this.threads.delete(id);
  }

  clear(): void {
    for (const entry of this.threads.values()) entry.thread.dispose();
    this.threads.clear();
  }

  dispose(): void {
    this.clear();
    this.controller.dispose();
  }
}

function formatBody(comment: HacklReviewComment): string {
  const lines = [comment.message];
  if (comment.rationale) {
    lines.push("");
    lines.push(`_${comment.rationale}_`);
  }
  return lines.join("\n");
}

const REVIEW_COMMENT_BLOCK_RE = /```(?:hackl-review|review)\s+([\s\S]*?)```/g;

export function parseReviewCommentsFromAnswer(
  answer: string,
  defaultUri?: string,
  origin?: { aiModel?: string },
): Array<Omit<HacklReviewComment, "id" | "status" | "createdAt">> {
  const results: Array<Omit<HacklReviewComment, "id" | "status" | "createdAt">> = [];
  let match: RegExpExecArray | null;
  while ((match = REVIEW_COMMENT_BLOCK_RE.exec(answer)) !== null) {
    try {
      const json = JSON.parse(match[1]);
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        const uri = typeof item.uri === "string" ? item.uri : defaultUri;
        if (!uri) continue;
        const startLine = Number(item.startLine ?? item.start_line ?? item.line);
        const endLine = Number(item.endLine ?? item.end_line ?? startLine);
        const severity = normalizeSeverity(item.severity);
        const message = String(item.message ?? "").trim();
        if (!message || !Number.isFinite(startLine) || !Number.isFinite(endLine)) continue;
        results.push({
          uri,
          startLine,
          endLine,
          severity,
          message,
          rationale: typeof item.rationale === "string" ? item.rationale : undefined,
          authorType: "ai",
          aiModel: origin?.aiModel,
        });
      }
    } catch {
      // ignore malformed blocks
    }
  }
  return results;
}

function normalizeSeverity(value: unknown): ReviewSeverity {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (text === "blocking" || text === "warning" || text === "suggestion" || text === "note") return text;
  return "note";
}
