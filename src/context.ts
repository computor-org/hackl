import type * as vscodeTypes from "vscode";

export interface ContextDocument {
  fileName: string;
  languageId: string;
  text: string;
  isActive: boolean;
  cursorLine?: number;
  cursorCharacter?: number;
  selection?: string;
}

export interface ContextOptions {
  maxOpenFileChars: number;
}

export function buildPromptContext(documents: ContextDocument[], options: ContextOptions): string {
  const sections = documents.map((document) => formatDocumentContext(document, options));
  return sections.join("\n\n---\n\n");
}

export function collectEditorContext(maxOpenFileChars: number): ContextDocument[] {
  const vscode = require("vscode") as typeof vscodeTypes;
  const activeEditor = vscode.window.activeTextEditor;
  const seen = new Set<string>();
  const documents: ContextDocument[] = [];

  if (activeEditor && !activeEditor.document.isUntitled) {
    addDocument(documents, seen, toContextDocument(activeEditor, true));
  }

  for (const editor of vscode.window.visibleTextEditors) {
    if (!editor.document.isUntitled) {
      addDocument(documents, seen, toContextDocument(editor, editor === activeEditor));
    }
  }

  for (const document of vscode.workspace.textDocuments) {
    if (!document.isUntitled && document.uri.scheme === "file") {
      addDocument(documents, seen, {
        fileName: document.fileName,
        languageId: document.languageId,
        text: document.getText(),
        isActive: activeEditor?.document.uri.toString() === document.uri.toString(),
      });
    }
  }

  return documents.map((document) => ({
    ...document,
    text: truncateMiddle(document.text, maxOpenFileChars),
  }));
}

function addDocument(documents: ContextDocument[], seen: Set<string>, document: ContextDocument): void {
  if (seen.has(document.fileName)) {
    return;
  }
  seen.add(document.fileName);
  documents.push(document);
}

function toContextDocument(editor: vscodeTypes.TextEditor, isActive: boolean): ContextDocument {
  const selection = editor.selection.isEmpty ? undefined : editor.document.getText(editor.selection);
  return {
    fileName: editor.document.fileName,
    languageId: editor.document.languageId,
    text: editor.document.getText(),
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
  const selection = document.selection ? `\n\nSelected code:\n${fence(document.languageId, document.selection)}` : "";
  const text = truncateMiddle(document.text, options.maxOpenFileChars);

  return [
    `File: ${document.fileName}`,
    `State: ${active}`,
    `Language: ${document.languageId}${cursor}`,
    selection,
    `\nContent:\n${fence(document.languageId, text)}`,
  ].join("\n");
}

function fence(languageId: string, text: string): string {
  return `\`\`\`${languageId}\n${text}\n\`\`\``;
}

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const keep = Math.max(0, Math.floor((maxChars - 80) / 2));
  return `${text.slice(0, keep)}\n\n[... ${text.length - keep * 2} characters omitted ...]\n\n${text.slice(-keep)}`;
}
