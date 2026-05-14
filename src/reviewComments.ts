import type * as vscodeTypes from "vscode";

export type ReviewSeverity = "note" | "suggestion" | "warning" | "blocking";
export type ReviewStatus = "open" | "resolved" | "dismissed";

export interface HacklReviewComment {
  id: string;
  targetId?: string;
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
  private lastBatchIds: string[] = [];

  beginBatch(): void {
    this.lastBatchIds = [];
  }

  recordBatch(ids: string[]): void {
    this.lastBatchIds = ids;
  }

  discardLastBatch(): number {
    let n = 0;
    for (const id of this.lastBatchIds) {
      const entry = this.threads.get(id);
      if (entry) {
        entry.thread.dispose();
        this.threads.delete(id);
        n += 1;
      }
    }
    this.lastBatchIds = [];
    return n;
  }

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
      targetId: input.targetId,
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
    thread.canReply = true;
    const body = new this.vscode.MarkdownString(formatBody(comment));
    body.isTrusted = false;
    const authorName = comment.authorType === "ai"
      ? `Hackl · ${comment.aiModel ?? "ai"}`
      : "You";
    const vscodeComment: vscodeTypes.Comment = {
      body,
      mode: this.vscode.CommentMode.Preview,
      author: { name: authorName },
      contextValue: `hackl:${comment.id}`,
    };
    thread.comments = [vscodeComment];
    this.threads.set(id, { thread, comment });
    return comment;
  }

  registerHumanComment(thread: vscodeTypes.CommentThread, message: string): HacklReviewComment {
    counter += 1;
    const id = `rev-${Date.now().toString(36)}-${counter.toString(36)}`;
    const startLine = (thread.range?.start.line ?? 0) + 1;
    const endLine = (thread.range?.end.line ?? 0) + 1;
    const comment: HacklReviewComment = {
      id,
      status: "open",
      uri: thread.uri.toString(),
      startLine,
      endLine,
      severity: "note",
      message,
      authorType: "human",
      createdAt: Date.now(),
    };
    const body = new this.vscode.MarkdownString(message);
    body.isTrusted = false;
    const existing = Array.isArray(thread.comments) ? [...thread.comments] : [];
    existing.push({
      body,
      mode: this.vscode.CommentMode.Preview,
      author: { name: "You" },
      contextValue: `hackl:${id}`,
    });
    thread.comments = existing;
    thread.label = "Hackl · note";
    thread.collapsibleState = this.vscode.CommentThreadCollapsibleState.Expanded;
    this.threads.set(id, { thread, comment });
    return comment;
  }

  disposeThread(thread: vscodeTypes.CommentThread): string[] {
    const removedIds: string[] = [];
    for (const [id, entry] of this.threads) {
      if (entry.thread === thread) {
        removedIds.push(id);
        this.threads.delete(id);
      }
    }
    thread.dispose();
    return removedIds;
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

export interface ParsedReviewComments {
  comments: Array<Omit<HacklReviewComment, "id" | "status" | "createdAt">>;
  blocks: number;
  parseErrors: number;
  dropped: Array<{ reason: string; raw?: string }>;
}

export function parseReviewCommentsFromAnswer(
  answer: string,
  defaultUri?: string,
  origin?: { aiModel?: string },
): ParsedReviewComments {
  const comments: ParsedReviewComments["comments"] = [];
  const dropped: ParsedReviewComments["dropped"] = [];
  let blocks = 0;
  let parseErrors = 0;
  let match: RegExpExecArray | null;
  while ((match = REVIEW_COMMENT_BLOCK_RE.exec(answer)) !== null) {
    blocks += 1;
    let json: unknown;
    try {
      json = JSON.parse(match[1]);
    } catch {
      parseErrors += 1;
      dropped.push({ reason: "invalid-json", raw: match[1].slice(0, 200) });
      continue;
    }
    const items = Array.isArray(json) ? json : [json];
    for (const raw of items) {
      const item = raw as Record<string, unknown>;
      const uri = typeof item.uri === "string" ? item.uri : defaultUri;
      if (!uri) { dropped.push({ reason: "missing-uri" }); continue; }
      const startLine = Number(item.startLine ?? item.start_line ?? item.line);
      const endLine = Number(item.endLine ?? item.end_line ?? startLine);
      const severity = normalizeSeverity(item.severity);
      const message = String(item.message ?? "").trim();
      if (!message) { dropped.push({ reason: "empty-message" }); continue; }
      if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
        dropped.push({ reason: "bad-lines" });
        continue;
      }
      if (startLine < 1 || endLine < startLine) {
        dropped.push({ reason: "bad-range" });
        continue;
      }
      comments.push({
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
  }
  return { comments, blocks, parseErrors, dropped };
}

function normalizeSeverity(value: unknown): ReviewSeverity {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (text === "blocking" || text === "warning" || text === "suggestion" || text === "note") return text;
  return "note";
}
