import type * as vscodeTypes from "vscode";
import { getVscode } from "./vscodeShim";

export type AnnotationSeverity = "note" | "suggestion" | "warning" | "blocking";
export type AnnotationStatus = "open" | "resolved" | "dismissed";

export interface HacklAnnotation {
  id: string;
  // Creation-time hint only. Re-resolve from basket via resolveTargetIdFor when needed;
  // do not trust this field after the basket has changed.
  targetId?: string;
  uri: string;
  startLine: number;
  endLine: number;
  severity: AnnotationSeverity;
  message: string;
  rationale?: string;
  status: AnnotationStatus;
  authorType: "human" | "ai";
  aiModel?: string;
  createdAt: number;
}

export type AnnotationAuthor = Pick<HacklAnnotation, "authorType" | "aiModel">;

let counter = 0;

interface ThreadEntry {
  thread: vscodeTypes.CommentThread;
  comment: HacklAnnotation;
}

const OPEN_THREAD_CONTEXT = "hackl.annotation.open";
const RESOLVED_THREAD_CONTEXT = "hackl.annotation.resolved";

export class AnnotationController {
  private controller: vscodeTypes.CommentController;
  private readonly threads = new Map<string, ThreadEntry>();
  private readonly vscode: typeof vscodeTypes;
  private batches: string[][] = [];

  beginBatch(): void {
    this.batches.push([]);
  }

  recordBatch(ids: string[]): void {
    if (this.batches.length === 0) this.batches.push([]);
    this.batches[this.batches.length - 1] = ids;
  }

  discardLastBatch(): number {
    let n = 0;
    while (this.batches.length > 0) {
      const ids = this.batches.pop()!;
      for (const id of ids) {
        const entry = this.threads.get(id);
        if (entry) {
          entry.thread.dispose();
          this.threads.delete(id);
          n += 1;
        }
      }
      if (n > 0) break;
    }
    return n;
  }

  private threadKey(uri: string, startLine: number, endLine: number): string {
    return `${uri}#${startLine}-${endLine}`;
  }

  findByLocation(uri: string, startLine: number, endLine: number): HacklAnnotation | undefined {
    for (const entry of this.threads.values()) {
      if (entry.comment.uri === uri && entry.comment.startLine === startLine && entry.comment.endLine === endLine) {
        return entry.comment;
      }
    }
    return undefined;
  }

  constructor() {
    this.vscode = getVscode();
    this.controller = this.vscode.comments.createCommentController("hackl.annotations", "Hackl Annotations");
    this.controller.options = {
      prompt: "Comment",
      placeHolder: "Comment. Enter submits, Shift+Enter for newline.",
    };
    const VscRange = this.vscode.Range;
    this.controller.commentingRangeProvider = {
      provideCommentingRanges(document: vscodeTypes.TextDocument): vscodeTypes.Range[] {
        return [new VscRange(0, 0, Math.max(0, document.lineCount - 1), 0)];
      },
    };
  }

  list(): HacklAnnotation[] {
    return Array.from(this.threads.values()).map((entry) => entry.comment);
  }

  addBatch(inputs: Array<Omit<HacklAnnotation, "id" | "status" | "createdAt"> & { status?: AnnotationStatus; createdAt?: number }>): HacklAnnotation[] {
    const created: HacklAnnotation[] = [];
    for (const input of inputs) {
      const dup = this.findDuplicate(input);
      const comment = this.add(input);
      if (!dup) created.push(comment);
    }
    if (created.length > 0) {
      this.batches.push(created.map((comment) => comment.id));
    }
    return created;
  }

  add(input: Omit<HacklAnnotation, "id" | "status" | "createdAt"> & { status?: AnnotationStatus; createdAt?: number }): HacklAnnotation {
    const dup = this.findDuplicate(input);
    if (dup) {
      return dup;
    }
    counter += 1;
    const id = `ann-${Date.now().toString(36)}-${counter.toString(36)}`;
    const comment: HacklAnnotation = {
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
    thread.contextValue = OPEN_THREAD_CONTEXT;
    thread.state = this.vscode.CommentThreadState?.Unresolved;
    const body = new this.vscode.MarkdownString(formatBody(comment));
    body.isTrusted = false;
    body.supportHtml = true;
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

  private findDuplicate(input: Pick<HacklAnnotation, "uri" | "startLine" | "endLine" | "message" | "severity" | "authorType">): HacklAnnotation | undefined {
    const dup = this.findByLocation(input.uri, input.startLine, input.endLine);
    if (dup && dup.message === input.message && dup.severity === input.severity && dup.authorType === input.authorType) {
      return dup;
    }
    return undefined;
  }

  registerHumanComment(thread: vscodeTypes.CommentThread, message: string): HacklAnnotation {
    return this.registerThreadComment(thread, message, { authorType: "human" });
  }

  registerAiComment(thread: vscodeTypes.CommentThread, message: string, aiModel?: string): HacklAnnotation {
    return this.registerThreadComment(thread, message, { authorType: "ai", aiModel });
  }

  private registerThreadComment(
    thread: vscodeTypes.CommentThread,
    message: string,
    author: AnnotationAuthor,
  ): HacklAnnotation {
    counter += 1;
    const id = `ann-${Date.now().toString(36)}-${counter.toString(36)}`;
    const startLine = (thread.range?.start.line ?? 0) + 1;
    const endLine = (thread.range?.end.line ?? 0) + 1;
    const comment: HacklAnnotation = {
      id,
      status: "open",
      uri: thread.uri.toString(),
      startLine,
      endLine,
      severity: "note",
      message,
      authorType: author.authorType,
      aiModel: author.aiModel,
      createdAt: Date.now(),
    };
    const body = new this.vscode.MarkdownString(wrapForUniformFont(message));
    body.isTrusted = false;
    body.supportHtml = true;
    const existing = Array.isArray(thread.comments) ? [...thread.comments] : [];
    existing.push({
      body,
      mode: this.vscode.CommentMode.Preview,
      author: { name: authorName(author) },
      contextValue: `hackl:${id}`,
    });
    thread.comments = existing;
    thread.label = "Hackl · note";
    thread.collapsibleState = this.vscode.CommentThreadCollapsibleState.Expanded;
    thread.canReply = true;
    thread.contextValue = OPEN_THREAD_CONTEXT;
    thread.state = this.vscode.CommentThreadState?.Unresolved;
    this.threads.set(id, { thread, comment });
    return comment;
  }

  resolveThread(thread: vscodeTypes.CommentThread): number {
    let n = 0;
    for (const entry of this.threads.values()) {
      if (entry.thread === thread && entry.comment.status === "open") {
        entry.comment.status = "resolved";
        n += 1;
      }
    }
    if (n === 0) return 0;
    thread.state = this.vscode.CommentThreadState?.Resolved;
    thread.contextValue = RESOLVED_THREAD_CONTEXT;
    thread.canReply = false;
    thread.collapsibleState = this.vscode.CommentThreadCollapsibleState.Collapsed;
    return n;
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
    this.resolveThread(entry.thread);
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

function formatBody(comment: HacklAnnotation): string {
  const lines = [comment.message];
  if (comment.rationale) {
    lines.push("");
    lines.push(`_${comment.rationale}_`);
  }
  return wrapForUniformFont(lines.join("\n"));
}

const UNIFORM_FONT_STYLE = "font-size:var(--vscode-editor-font-size);font-family:var(--vscode-font-family);line-height:1.4";

function wrapForUniformFont(markdown: string): string {
  return `<span style="${UNIFORM_FONT_STYLE}">\n\n${markdown}\n\n</span>`;
}

function authorName(author: AnnotationAuthor): string {
  if (author.authorType === "human") return "You";
  return `Hackl · ${author.aiModel ?? "ai"}`;
}

const ANNOTATION_BLOCK_RE = /```(?:hackl-annotations|hackl-review|review)\s*([\s\S]*?)```/g;

export interface ParsedAnnotations {
  annotations: Array<Omit<HacklAnnotation, "id" | "status" | "createdAt">>;
  blocks: number;
  parseErrors: number;
  dropped: Array<{ reason: string; raw?: string }>;
}

export function parseAnnotationsFromAnswer(
  answer: string,
  defaultUri?: string,
  origin?: { aiModel?: string },
): ParsedAnnotations {
  const annotations: ParsedAnnotations["annotations"] = [];
  const dropped: ParsedAnnotations["dropped"] = [];
  let blocks = 0;
  let parseErrors = 0;
  let match: RegExpExecArray | null;
  ANNOTATION_BLOCK_RE.lastIndex = 0;
  while ((match = ANNOTATION_BLOCK_RE.exec(answer)) !== null) {
    blocks += 1;
    let json: unknown;
    try {
      json = parseAnnotationJson(match[1]);
    } catch {
      parseErrors += 1;
      dropped.push({ reason: "invalid-json", raw: match[1].slice(0, 200) });
      continue;
    }
    const items = annotationItems(json);
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
      annotations.push({
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
  return { annotations, blocks, parseErrors, dropped };
}

function parseAnnotationJson(raw: string): unknown {
  const trimmed = raw.trim();
  const withoutLanguageLine = trimmed.replace(/^(?:json|javascript|js)\s*\r?\n/i, "").trim();
  const candidates = [trimmed, withoutLanguageLine, extractJsonValue(withoutLanguageLine)]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function extractJsonValue(text: string): string | undefined {
  const arrayStart = text.indexOf("[");
  const objectStart = text.indexOf("{");
  const starts = [arrayStart, objectStart].filter((n) => n >= 0);
  if (starts.length === 0) return undefined;
  const start = Math.min(...starts);
  const end = text[start] === "[" ? text.lastIndexOf("]") : text.lastIndexOf("}");
  if (end <= start) return undefined;
  return text.slice(start, end + 1);
}

function annotationItems(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const wrapped = (json as { annotations?: unknown }).annotations;
    if (Array.isArray(wrapped)) return wrapped;
  }
  return [json];
}

function normalizeSeverity(value: unknown): AnnotationSeverity {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (text === "blocking" || text === "warning" || text === "suggestion" || text === "note") return text;
  return "note";
}
