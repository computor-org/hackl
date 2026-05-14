import type * as vscodeTypes from "vscode";

type Listener<T> = (value: T) => void;

class SimpleEmitter<T> {
  private listeners: Array<Listener<T>> = [];
  readonly event = (listener: Listener<T>): { dispose(): void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };
  fire(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }
  dispose(): void {
    this.listeners = [];
  }
}

export type HacklTarget =
  | SourceRangeTarget
  | StagedChangesTarget
  | DiffRangeTarget
  | CommitTarget
  | MarkdownSectionTarget
  | DiagnosticTarget;

export interface BaseTarget {
  id: string;
  addedAt: number;
  metadata?: Record<string, unknown>;
}

export interface ReviewContext {
  source?: string;
  role?: string;
  externalIds?: Record<string, string>;
  rubricUri?: string;
  policyHints?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SourceRangeTarget extends BaseTarget {
  kind: "source-range";
  uri: string;
  languageId: string;
  relativePath: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  text: string;
  truncated: boolean;
}

export interface MarkdownSectionTarget extends BaseTarget {
  kind: "markdown-section";
  uri: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  headingPath: string[];
  text: string;
  truncated: boolean;
}

export interface StagedChangesTarget extends BaseTarget {
  kind: "staged-changes";
  workspaceRoot: string;
  files: string[];
  diff: string;
  diffTruncated: boolean;
}

export interface DiffRangeTarget extends BaseTarget {
  kind: "diff-range";
  workspaceRoot: string;
  base: string;
  head: string;
  files: string[];
  diff: string;
  diffTruncated: boolean;
}

export interface CommitTarget extends BaseTarget {
  kind: "commit";
  workspaceRoot: string;
  sha: string;
  subject: string;
  files: string[];
  diff: string;
  diffTruncated: boolean;
}

export interface DiagnosticTarget extends BaseTarget {
  kind: "diagnostic";
  uri: string;
  relativePath: string;
  message: string;
  severity: string;
  startLine: number;
  endLine: number;
  source?: string;
}

export interface BasketSnapshot {
  targets: HacklTarget[];
  reviewContext?: ReviewContext;
}

const MAX_TEXT_CHARS = 4000;
const MAX_DIFF_CHARS = 12000;

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function truncate(text: string, max = MAX_TEXT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

export function truncateDiff(diff: string): { diff: string; truncated: boolean } {
  if (diff.length <= MAX_DIFF_CHARS) return { diff, truncated: false };
  return { diff: diff.slice(0, MAX_DIFF_CHARS), truncated: true };
}

export class BasketService {
  private targets: HacklTarget[] = [];
  private reviewContext: ReviewContext | undefined;
  private readonly emitter = new SimpleEmitter<BasketSnapshot>();
  readonly onDidChange = this.emitter.event;

  snapshot(): BasketSnapshot {
    return {
      targets: [...this.targets],
      reviewContext: this.reviewContext,
    };
  }

  setReviewContext(context: ReviewContext | undefined): void {
    if (sameReviewContext(this.reviewContext, context)) return;
    this.reviewContext = context;
    this.fire();
  }

  getReviewContext(): ReviewContext | undefined {
    return this.reviewContext;
  }

  add(target: HacklTarget): void {
    if (this.findDuplicate(target)) return;
    this.targets.push(target);
    this.fire();
  }

  remove(id: string): void {
    const before = this.targets.length;
    this.targets = this.targets.filter((t) => t.id !== id);
    if (this.targets.length !== before) this.fire();
  }

  clear(): void {
    if (this.targets.length === 0) return;
    this.targets = [];
    this.fire();
  }

  list(): HacklTarget[] {
    return [...this.targets];
  }

  private findDuplicate(target: HacklTarget): HacklTarget | undefined {
    return this.targets.find((existing) => {
      if (existing.kind !== target.kind) return false;
      if (existing.kind === "source-range" && target.kind === "source-range") {
        const sameRange =
          existing.uri === target.uri &&
          existing.startLine === target.startLine &&
          existing.endLine === target.endLine &&
          existing.startCharacter === target.startCharacter &&
          existing.endCharacter === target.endCharacter;
        if (!sameRange) return false;
        const aKey = (existing.metadata as { threadKey?: string } | undefined)?.threadKey;
        const bKey = (target.metadata as { threadKey?: string } | undefined)?.threadKey;
        return aKey === bKey;
      }
      if (existing.kind === "staged-changes" && target.kind === "staged-changes") {
        return existing.workspaceRoot === target.workspaceRoot;
      }
      if (existing.kind === "markdown-section" && target.kind === "markdown-section") {
        return (
          existing.uri === target.uri &&
          existing.startLine === target.startLine &&
          existing.endLine === target.endLine
        );
      }
      if (existing.kind === "commit" && target.kind === "commit") {
        return existing.sha === target.sha;
      }
      return false;
    });
  }

  private fire(): void {
    this.emitter.fire(this.snapshot());
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function sameReviewContext(a: ReviewContext | undefined, b: ReviewContext | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createSourceRangeTarget(editor: vscodeTypes.TextEditor): SourceRangeTarget | undefined {
  if (editor.selection.isEmpty) return undefined;
  const vscode = require("vscode") as typeof vscodeTypes;
  const raw = editor.document.getText(editor.selection);
  const { text, truncated } = truncate(raw);
  return {
    id: newId("src"),
    addedAt: Date.now(),
    kind: "source-range",
    uri: editor.document.uri.toString(),
    languageId: editor.document.languageId,
    relativePath: vscode.workspace.asRelativePath(editor.document.uri, false),
    startLine: editor.selection.start.line + 1,
    startCharacter: editor.selection.start.character + 1,
    endLine: editor.selection.end.line + 1,
    endCharacter: editor.selection.end.character + 1,
    text,
    truncated,
  };
}

export function createMarkdownSectionTarget(editor: vscodeTypes.TextEditor): MarkdownSectionTarget | undefined {
  const document = editor.document;
  if (document.languageId !== "markdown") return undefined;
  const vscode = require("vscode") as typeof vscodeTypes;
  const cursorLine = editor.selection.active.line;
  const { startLine, endLine, headingPath } = findMarkdownSection(document, cursorLine);
  const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
  const raw = document.getText(range);
  const { text, truncated } = truncate(raw);
  return {
    id: newId("md"),
    addedAt: Date.now(),
    kind: "markdown-section",
    uri: document.uri.toString(),
    relativePath: vscode.workspace.asRelativePath(document.uri, false),
    startLine: startLine + 1,
    endLine: endLine + 1,
    headingPath,
    text,
    truncated,
  };
}

function findMarkdownSection(document: vscodeTypes.TextDocument, cursorLine: number): {
  startLine: number;
  endLine: number;
  headingPath: string[];
} {
  const headings: Array<{ line: number; level: number; text: string }> = [];
  for (let i = 0; i < document.lineCount; i++) {
    const lineText = document.lineAt(i).text;
    const match = /^(#{1,6})\s+(.*)$/.exec(lineText);
    if (match) {
      headings.push({ line: i, level: match[1].length, text: match[2].trim() });
    }
  }
  let startHeadingIndex = -1;
  for (let i = headings.length - 1; i >= 0; i--) {
    if (headings[i].line <= cursorLine) {
      startHeadingIndex = i;
      break;
    }
  }
  if (startHeadingIndex === -1) {
    return { startLine: 0, endLine: Math.min(document.lineCount - 1, cursorLine + 40), headingPath: [] };
  }
  const startHeading = headings[startHeadingIndex];
  let endLine = document.lineCount - 1;
  for (let j = startHeadingIndex + 1; j < headings.length; j++) {
    if (headings[j].level <= startHeading.level) {
      endLine = headings[j].line - 1;
      break;
    }
  }
  const headingPath: string[] = [];
  let level = startHeading.level + 1;
  for (let k = startHeadingIndex; k >= 0; k--) {
    if (headings[k].level < level) {
      headingPath.unshift(headings[k].text);
      level = headings[k].level;
      if (level === 1) break;
    }
  }
  return { startLine: startHeading.line, endLine, headingPath };
}

export function createStagedChangesTarget(args: {
  workspaceRoot: string;
  files: string[];
  diff: string;
}): StagedChangesTarget {
  const { diff, truncated } = truncateDiff(args.diff);
  return {
    id: newId("staged"),
    addedAt: Date.now(),
    kind: "staged-changes",
    workspaceRoot: args.workspaceRoot,
    files: args.files,
    diff,
    diffTruncated: truncated,
  };
}

export function createReviewNoteTarget(args: {
  uri: string;
  languageId: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  endCharacter: number;
  code: string;
  note: string;
  threadKey: string;
}): SourceRangeTarget {
  const { text, truncated } = truncate(args.code);
  return {
    id: newId("ann"),
    addedAt: Date.now(),
    kind: "source-range",
    uri: args.uri,
    languageId: args.languageId,
    relativePath: args.relativePath,
    startLine: args.startLine,
    startCharacter: 1,
    endLine: args.endLine,
    endCharacter: args.endCharacter,
    text,
    truncated,
    metadata: { note: args.note, threadKey: args.threadKey },
  };
}

export function createCommitTarget(args: {
  workspaceRoot: string;
  sha: string;
  subject: string;
  files: string[];
  diff: string;
}): CommitTarget {
  const { diff, truncated } = truncateDiff(args.diff);
  return {
    id: newId("commit"),
    addedAt: Date.now(),
    kind: "commit",
    workspaceRoot: args.workspaceRoot,
    sha: args.sha,
    subject: args.subject,
    files: args.files,
    diff,
    diffTruncated: truncated,
  };
}

export function describeTarget(target: HacklTarget): string {
  switch (target.kind) {
    case "source-range":
      return `${target.relativePath}:${target.startLine}-${target.endLine}`;
    case "markdown-section": {
      const heading = target.headingPath.length ? ` # ${target.headingPath.join(" › ")}` : "";
      return `${target.relativePath}:${target.startLine}-${target.endLine}${heading}`;
    }
    case "staged-changes":
      return `staged diff: ${target.files.length} file${target.files.length === 1 ? "" : "s"}`;
    case "diff-range":
      return `diff ${target.base}..${target.head}: ${target.files.length} files`;
    case "commit":
      return `commit ${target.sha.slice(0, 7)} ${target.subject}`;
    case "diagnostic":
      return `${target.relativePath}:${target.startLine} (${target.severity})`;
  }
}
