import * as path from "node:path";
import * as vscode from "vscode";
import type { ToolRequest, ToolResult } from "./tools";

export interface WorkspaceToolOptions {
  maxFileChars: number;
}

export function createWorkspaceToolRunner(options: WorkspaceToolOptions): (request: ToolRequest) => Promise<ToolResult> {
  return async (request) => {
    if (request.name !== "read_file") {
      return { ok: false, content: `Unsupported tool: ${request.name}` };
    }
    return readFile(request, options.maxFileChars);
  };
}

async function readFile(request: ToolRequest, maxFileChars: number): Promise<ToolResult> {
  const uri = resolveWorkspaceUri(request.path);
  if (!uri) {
    return { ok: false, content: "Path is outside the current workspace or cannot be resolved." };
  }

  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const start = Math.max(1, request.start_line ?? 1);
    const end = Math.min(document.lineCount, Math.max(start, request.end_line ?? Math.min(start + 119, document.lineCount)));
    const content = readLineRange(document, start, end, maxFileChars);
    return { ok: true, content };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: message };
  }
}

function resolveWorkspaceUri(requestPath: string): vscode.Uri | undefined {
  const openDocument = findOpenDocument(requestPath);
  if (openDocument) {
    return openDocument.uri;
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const candidate = path.isAbsolute(requestPath)
      ? path.normalize(requestPath)
      : path.normalize(path.join(folder.uri.fsPath, requestPath));
    if (isWithin(folder.uri.fsPath, candidate)) {
      return vscode.Uri.file(candidate);
    }
  }
  return undefined;
}

function findOpenDocument(requestPath: string): vscode.TextDocument | undefined {
  const normalized = path.normalize(requestPath);
  return vscode.workspace.textDocuments.find((document) => {
    if (document.uri.scheme !== "file") {
      return false;
    }
    return path.normalize(document.fileName) === normalized || vscode.workspace.asRelativePath(document.uri, false) === requestPath;
  });
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.normalize(root), candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readLineRange(document: vscode.TextDocument, startLine: number, endLine: number, maxChars: number): string {
  const lines: string[] = [];
  let chars = 0;

  for (let line = startLine; line <= endLine; line++) {
    const text = document.lineAt(line - 1).text;
    chars += text.length + 1;
    if (chars > maxChars) {
      lines.push(`[truncated after ${maxChars} characters]`);
      break;
    }
    lines.push(`${line}: ${text}`);
  }

  return lines.join("\n");
}
