import type * as vscodeTypes from "vscode";
import { getVscode } from "./vscodeShim";
import type { DebugLog } from "./debugLog";

// Annotation types are owned by @hackl/core; re-export for "./annotations"
// consumers and import the ones used internally below.
import type { HacklAnnotation, AnnotationSeverity, AnnotationStatus, AnnotationAuthor } from "@hackl/core";
export type {
  AnnotationSeverity,
  AnnotationStatus,
  HacklAnnotation,
  AnnotationAuthor,
} from "@hackl/core";

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
  private debug: DebugLog | undefined;
  private batches: string[][] = [];
  private commentingProvider: vscodeTypes.CommentingRangeProvider | undefined;

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
      prompt: "Add note",
      placeHolder: "Note. Ctrl+Enter submits.",
    };
    this.refreshCommentingRanges();
  }

  /**
   * Install the commenting range provider once.
   *
   * Reassigning `commentingRangeProvider` makes VS Code recompute comments by
   * disposing all mounted ReviewZoneWidgets. That steals focus from the native
   * gutter-plus "Start discussion" editor, so this method is intentionally
   * idempotent. The provider itself returns a document range with file
   * comments enabled so the gutter strip remains armed without provider churn.
   */
  refreshCommentingRanges(): void {
    if (this.commentingProvider) {
      this.debug?.("annotations.refreshCommentingRanges.alreadyInstalled");
      return;
    }
    this.commentingProvider = this.createCommentingRangeProvider();
    this.controller.commentingRangeProvider = this.commentingProvider;
    this.debug?.("annotations.refreshCommentingRanges.assigned");
  }

  setDebugLog(debug: DebugLog | undefined): void {
    this.debug = debug;
  }

  private createCommentingRangeProvider(): vscodeTypes.CommentingRangeProvider {
    const VscRange = this.vscode.Range;
    const debug = this.debug;
    return {
      provideCommentingRanges(document: vscodeTypes.TextDocument): vscodeTypes.CommentingRanges {
        const supported = isEditorDocumentScheme(document.uri?.scheme);
        if (!supported) {
          debug?.("annotations.provideCommentingRanges.unsupportedScheme", {
            uri: document.uri?.toString(),
            scheme: document.uri?.scheme,
            languageId: document.languageId,
          });
          return { enableFileComments: true, ranges: [] };
        }
        const lastLine = Math.max(0, document.lineCount - 1);
        const ranges = [new VscRange(0, 0, lastLine, 0)];
        debug?.("annotations.provideCommentingRanges", {
          uri: document.uri.toString(),
          languageId: document.languageId,
          lineCount: document.lineCount,
          ranges: ranges.length,
        });
        return { enableFileComments: true, ranges };
      },
    };
  }

  list(): HacklAnnotation[] {
    return Array.from(this.threads.values()).map((entry) => entry.comment);
  }

  /**
   * Reveal a thread in its editor, plant the cursor on its line, and, when
   * possible, land focus directly in the reply input so the user can type
   * straight away.
   *
   * The reliable path is to pass `selection` to `showTextDocument`: VS Code
   * applies it before returning the editor, so the cursor lands on the line
   * even when the source of the call (our chat webview) currently owns
   * focus. We then force focus onto the editor group, because a webview that
   * holds focus is not automatically displaced by `preserveFocus: false`.
   *
   * For the reply input itself there is no public command. We do not declare
   * the `commentReveal` proposal in the manifest, because the Marketplace and
   * vsce reject proposed APIs. We still probe `CommentThread.reveal({focus:
   * Reply})` at runtime in case a host injects it (a dev host that enables the
   * proposal, or a future stable version), and otherwise fall back to
   * `workbench.action.focusCommentOnCurrentLine`, which at least focuses the
   * comment widget on the line we just moved to.
   */
  async focusThreadReply(annotationId: string): Promise<void> {
    const entry = this.threads.get(annotationId);
    if (!entry) {
      this.debug?.("annotations.focusThreadReply.unknownId", { id: annotationId });
      return;
    }
    const { thread, comment } = entry;
    const line = Math.max(0, comment.startLine - 1);
    const pos = new this.vscode.Position(line, 0);
    const selection = new this.vscode.Range(pos, pos);
    try {
      const uri = this.vscode.Uri.parse(comment.uri);
      const doc = await this.vscode.workspace.openTextDocument(uri);
      await this.vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: false,
        selection,
      });
    } catch (error) {
      this.debug?.("annotations.focusThreadReply.openFailed", { id: annotationId, error: String(error) });
      return;
    }
    // Try CommentThread.reveal first: the proposed commentReveal API lands
    // focus directly inside the reply textarea. If the host doesn't expose it
    // (stable VS Code without --enable-proposed-api), fall through to the
    // public command, which at least focuses the comment widget on the line
    // we just placed the cursor on. We deliberately do NOT call
    // workbench.action.focusActiveEditorGroup here: focus that reveal places
    // in the reply textarea would be yanked back to the editor group.
    const reveal = (thread as unknown as { reveal?: (commentOrOptions?: unknown, options?: unknown) => Thenable<void> }).reveal;
    if (typeof reveal === "function") {
      try {
        await reveal.call(thread, undefined, { focus: 1 });
        this.debug?.("annotations.focusThreadReply.revealed", { id: annotationId });
        return;
      } catch (error) {
        this.debug?.("annotations.focusThreadReply.revealFailed", { id: annotationId, error: String(error) });
      }
    }
    try {
      await this.vscode.commands.executeCommand("workbench.action.focusCommentOnCurrentLine");
    } catch (error) {
      this.debug?.("annotations.focusThreadReply.commandFailed", { id: annotationId, error: String(error) });
    }
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
    const body = new this.vscode.MarkdownString(wrapForUniformFont(escapeHtml(message).replace(/\n/g, "<br>")));
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
    thread.canReply = false;
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

function isEditorDocumentScheme(scheme: string | undefined): boolean {
  return scheme === "file" || scheme === "untitled" || scheme === "vscode-remote";
}

function formatBody(comment: HacklAnnotation): string {
  let html = escapeHtml(comment.message).replace(/\n/g, "<br>");
  if (comment.rationale) {
    html += `<br><br><em>${escapeHtml(comment.rationale).replace(/\n/g, "<br>")}</em>`;
  }
  return wrapForUniformFont(html);
}

const UNIFORM_FONT_STYLE = "font-size:var(--vscode-editor-font-size);font-family:var(--vscode-font-family);line-height:1.4";

function wrapForUniformFont(html: string): string {
  return `<span style="${UNIFORM_FONT_STYLE}">${html}</span>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
