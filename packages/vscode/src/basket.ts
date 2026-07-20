import type * as vscodeTypes from "vscode";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { getVscode } from "./vscodeShim";

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

// Target/basket types are owned by @hackl/core; re-export for existing
// "./basket" consumers and import the ones used internally below.
import type {
  HacklTarget,
  BasketSnapshot,
  SourceRangeTarget,
  MarkdownSectionTarget,
  StagedChangesTarget,
  CommitTarget,
  AnnotationLineRange,
} from "@hackl/core";
export type {
  BaseTarget,
  SourceRangeTarget,
  MarkdownSectionTarget,
  StagedChangesTarget,
  CommitTarget,
  HacklTarget,
  BasketSnapshot,
  AnnotationLineRange,
} from "@hackl/core";

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
  private readonly emitter = new SimpleEmitter<BasketSnapshot>();
  readonly onDidChange = this.emitter.event;

  snapshot(): BasketSnapshot {
    return {
      targets: [...this.targets],
    };
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

export function createSourceRangeTarget(editor: vscodeTypes.TextEditor): SourceRangeTarget | undefined {
  if (editor.selection.isEmpty) return undefined;
  const vscode = getVscode();
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

export function createCurrentFileTarget(editor: vscodeTypes.TextEditor): SourceRangeTarget | undefined {
  const vscode = getVscode();
  const doc = editor.document;
  if (doc.lineCount < 1) return undefined;
  const lastLine = Math.max(0, doc.lineCount - 1);
  const lastLineText = doc.lineAt(lastLine).text;
  const fullRange = new vscode.Range(0, 0, lastLine, lastLineText.length);
  const raw = doc.getText(fullRange);
  const { text, truncated } = truncate(raw);
  return {
    id: newId("file"),
    addedAt: Date.now(),
    kind: "source-range",
    uri: doc.uri.toString(),
    languageId: doc.languageId,
    relativePath: vscode.workspace.asRelativePath(doc.uri, false),
    startLine: 1,
    startCharacter: 1,
    endLine: doc.lineCount,
    endCharacter: lastLineText.length + 1,
    text,
    truncated,
    metadata: { scope: "current-file" },
  };
}

export function createMarkdownSectionTarget(editor: vscodeTypes.TextEditor): MarkdownSectionTarget | undefined {
  const document = editor.document;
  if (document.languageId !== "markdown") return undefined;
  const vscode = getVscode();
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
  revealFiles?: string[];
  diff: string;
}): StagedChangesTarget {
  const { diff, truncated } = truncateDiff(args.diff);
  const metadata = diffTargetMetadata(args.workspaceRoot, diff, args.revealFiles);
  return {
    id: newId("staged"),
    addedAt: Date.now(),
    kind: "staged-changes",
    workspaceRoot: args.workspaceRoot,
    files: args.files,
    diff,
    diffTruncated: truncated,
    metadata,
  };
}

export function createAnnotationNoteTarget(args: {
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
  revealFiles?: string[];
  diff: string;
}): CommitTarget {
  const { diff, truncated } = truncateDiff(args.diff);
  const metadata = diffTargetMetadata(args.workspaceRoot, diff, args.revealFiles);
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
    metadata,
  };
}

function diffTargetMetadata(
  workspaceRoot: string,
  diff: string,
  revealFiles?: string[],
): Record<string, unknown> | undefined {
  const annotationLineRanges = annotationLineRangesFromDiff(workspaceRoot, diff);
  if (!revealFiles && annotationLineRanges.length === 0) return undefined;
  return {
    ...(revealFiles ? { revealFiles } : {}),
    ...(annotationLineRanges.length > 0 ? { annotationLineRanges } : {}),
  };
}

export function annotationLineRangesFromDiff(workspaceRoot: string, diff: string): AnnotationLineRange[] {
  const ranges: AnnotationLineRange[] = [];
  let uri: string | undefined;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      const file = line.slice(4).trim();
      uri = file === "/dev/null" ? undefined : diffFileUri(workspaceRoot, file);
      continue;
    }
    if (!uri || !line.startsWith("@@ ")) continue;
    const match = /\+(\d+)(?:,(\d+))?/.exec(line);
    if (!match) continue;
    const startLine = Number(match[1]);
    const count = Number(match[2] ?? "1");
    if (!Number.isFinite(startLine) || !Number.isFinite(count) || count < 1) continue;
    ranges.push({ uri, startLine, endLine: startLine + count - 1 });
  }
  return ranges;
}

function diffFileUri(workspaceRoot: string, file: string): string {
  const withoutPrefix = file.replace(/^[ab]\//, "");
  return pathToFileURL(path.resolve(workspaceRoot, withoutPrefix)).toString();
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
      return `staged diff: ${target.files.length} file${target.files.length === 1 ? "" : "s"}${target.diffTruncated ? " (truncated)" : ""}`;
    case "commit":
      return `commit ${target.sha.slice(0, 7)} ${target.subject}${target.diffTruncated ? " (diff truncated)" : ""}`;
  }
}
