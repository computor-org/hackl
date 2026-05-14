import type * as vscodeTypes from "vscode";
import { getVscode } from "./vscodeShim";

export interface ContextDocument {
  fileName: string;
  path: string;
  languageId: string;
  isActive: boolean;
  cursorLine?: number;
  cursorCharacter?: number;
  selection?: ContextSelection;
  selectionText?: string;
  selectionTruncated?: boolean;
}

export interface ContextSelection {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface ContextOptions {
  maxToolFileChars: number;
  maxSelectionChars?: number;
}

const DEFAULT_SELECTION_CHARS = 4000;

export function buildPromptContext(documents: ContextDocument[], options: ContextOptions): string {
  if (documents.length === 0) {
    return "";
  }
  const sections = documents.map((document) => formatDocumentContext(document, options));
  return [`ctx (read_file max ${options.maxToolFileChars} chars):`, ...sections].join("\n");
}

export function collectEditorContext(): ContextDocument[] {
  const vscode = getVscode();
  const activeEditor = vscode.window.activeTextEditor;
  const seen = new Set<string>();
  const documents: ContextDocument[] = [];

  if (activeEditor && !activeEditor.document.isUntitled) {
    addDocument(documents, seen, toContextDocument(vscode, activeEditor, true));
  }

  for (const editor of vscode.window.visibleTextEditors) {
    if (!editor.document.isUntitled) {
      addDocument(documents, seen, toContextDocument(vscode, editor, editor === activeEditor));
    }
  }

  for (const document of vscode.workspace.textDocuments) {
    if (!document.isUntitled && document.uri.scheme === "file") {
      addDocument(documents, seen, {
        fileName: document.fileName,
        path: editorPath(vscode, document.uri, document.fileName),
        languageId: document.languageId,
        isActive: activeEditor?.document.uri.toString() === document.uri.toString(),
      });
    }
  }

  return documents;
}

function addDocument(documents: ContextDocument[], seen: Set<string>, document: ContextDocument): void {
  if (seen.has(document.fileName)) {
    return;
  }
  seen.add(document.fileName);
  documents.push(document);
}

function toContextDocument(
  vscode: typeof vscodeTypes,
  editor: vscodeTypes.TextEditor,
  isActive: boolean,
): ContextDocument {
  const hasSelection = !editor.selection.isEmpty;
  const selection = hasSelection ? {
    startLine: editor.selection.start.line + 1,
    startCharacter: editor.selection.start.character + 1,
    endLine: editor.selection.end.line + 1,
    endCharacter: editor.selection.end.character + 1,
  } : undefined;

  let selectionText: string | undefined;
  let selectionTruncated = false;
  if (hasSelection) {
    const raw = editor.document.getText(editor.selection);
    if (raw.length > DEFAULT_SELECTION_CHARS) {
      selectionText = raw.slice(0, DEFAULT_SELECTION_CHARS);
      selectionTruncated = true;
    } else {
      selectionText = raw;
    }
  }

  return {
    fileName: editor.document.fileName,
    path: editorPath(vscode, editor.document.uri, editor.document.fileName),
    languageId: editor.document.languageId,
    isActive,
    cursorLine: editor.selection.active.line + 1,
    cursorCharacter: editor.selection.active.character + 1,
    selection,
    selectionText,
    selectionTruncated: selectionTruncated || undefined,
  };
}

function formatDocumentContext(document: ContextDocument, options: ContextOptions): string {
  const state = document.isActive ? "active" : "open";
  const cursor = document.cursorLine === undefined
    ? ""
    : ` cur ${document.cursorLine}:${document.cursorCharacter}`;
  const selection = document.selection ? ` sel ${formatSelection(document.selection)}` : "";
  const header = `- ${document.path} [${state} ${document.languageId}]${cursor}${selection}`;
  const cap = options.maxSelectionChars ?? DEFAULT_SELECTION_CHARS;
  if (!document.selectionText) {
    return header;
  }
  const text = document.selectionText.length > cap
    ? document.selectionText.slice(0, cap)
    : document.selectionText;
  const truncated = document.selectionTruncated || document.selectionText.length > cap;
  const fence = "```" + (document.languageId || "");
  const suffix = truncated ? "\n...(selection truncated)" : "";
  return `${header}\nselection:\n${fence}\n${text}${suffix}\n\`\`\``;
}

function formatSelection(selection: ContextSelection): string {
  if (selection.startLine === selection.endLine) {
    return `${selection.startLine}:${selection.startCharacter}-${selection.endCharacter}`;
  }
  return `${selection.startLine}:${selection.startCharacter}-${selection.endLine}:${selection.endCharacter}`;
}

function editorPath(vscode: typeof vscodeTypes, uri: vscodeTypes.Uri, fallback: string): string {
  if (typeof vscode.workspace.asRelativePath === "function") {
    return vscode.workspace.asRelativePath(uri, false);
  }
  return fallback;
}
