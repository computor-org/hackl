import type * as vscodeTypes from "vscode";

export interface ContextDocument {
  fileName: string;
  path: string;
  languageId: string;
  isActive: boolean;
  cursorLine?: number;
  cursorCharacter?: number;
  selection?: ContextSelection;
}

export interface ContextSelection {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface ContextOptions {
  maxToolFileChars: number;
}

export function buildPromptContext(documents: ContextDocument[], options: ContextOptions): string {
  if (documents.length === 0) {
    return "";
  }
  const sections = documents.map((document) => formatDocumentContext(document, options));
  return [
    "Open editor metadata only. File contents and selected text are omitted.",
    `Use read_file when contents are needed. read_file returns at most ${options.maxToolFileChars} characters.`,
    "",
    sections.join("\n"),
  ].join("\n");
}

export function collectEditorContext(): ContextDocument[] {
  const vscode = require("vscode") as typeof vscodeTypes;
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
  const selection = editor.selection.isEmpty ? undefined : {
    startLine: editor.selection.start.line + 1,
    startCharacter: editor.selection.start.character + 1,
    endLine: editor.selection.end.line + 1,
    endCharacter: editor.selection.end.character + 1,
  };

  return {
    fileName: editor.document.fileName,
    path: editorPath(vscode, editor.document.uri, editor.document.fileName),
    languageId: editor.document.languageId,
    isActive,
    cursorLine: editor.selection.active.line + 1,
    cursorCharacter: editor.selection.active.character + 1,
    selection,
  };
}

function formatDocumentContext(document: ContextDocument, options: ContextOptions): string {
  const active = document.isActive ? "active" : "open";
  const cursor = document.cursorLine === undefined
    ? ""
    : `\nCursor: line ${document.cursorLine}, column ${document.cursorCharacter}`;
  const selection = document.selection ? `\nSelection: ${formatSelection(document.selection)}` : "";

  return [
    `- File: ${document.path}`,
    `  Absolute path: ${document.fileName}`,
    `  State: ${active}`,
    `  Language: ${document.languageId}${cursor}${selection}`,
    `  Content: omitted; request read_file for a needed range.`,
  ].join("\n");
}

function formatSelection(selection: ContextSelection): string {
  if (selection.startLine === selection.endLine) {
    return `line ${selection.startLine}, columns ${selection.startCharacter}-${selection.endCharacter}`;
  }
  return [
    `line ${selection.startLine}, column ${selection.startCharacter}`,
    `to line ${selection.endLine}, column ${selection.endCharacter}`,
  ].join(" ");
}

function editorPath(vscode: typeof vscodeTypes, uri: vscodeTypes.Uri, fallback: string): string {
  if (typeof vscode.workspace.asRelativePath === "function") {
    return vscode.workspace.asRelativePath(uri, false);
  }
  return fallback;
}
