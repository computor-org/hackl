import * as path from "node:path";
import * as fsp from "node:fs/promises";
import type * as vscodeTypes from "vscode";
import { getVscode } from "./vscodeShim";
import {
  createWorkspaceToolRunner as coreCreateWorkspaceToolRunner,
  createNodeWorkspaceHost,
} from "@hackl/core";
import type {
  WorkspaceToolHost,
  WorkspaceToolOptions,
  ApprovalPrompt,
  ReadFileRequest,
  ReplaceTextRequest,
  SearchFilesRequest,
  ToolRequest,
  ToolResult,
} from "@hackl/core";

export { createNodeWorkspaceHost };
export type { WorkspaceToolHost, WorkspaceToolOptions, ApprovalPrompt };

const MAX_TOOL_FILE_BYTES = 1_000_000;
const BINARY_SAMPLE_BYTES = 8192;

// The tool runner lives in @hackl/core and requires an injected host. This
// VS Code wrapper defaults the host to the live VS Code workspace so existing
// call sites (and tests) that omit `workspace` keep working.
export function createWorkspaceToolRunner(
  options: Omit<WorkspaceToolOptions, "workspace"> & { workspace?: WorkspaceToolHost },
): (request: ToolRequest) => Promise<ToolResult> {
  return coreCreateWorkspaceToolRunner({
    ...options,
    workspace: options.workspace ?? createVsCodeWorkspaceHost(),
  });
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.normalize(root), candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readLineRange(linesSource: { lineCount: number; lineAt(line: number): { text: string } }, startLine: number, endLine: number, maxChars: number): string {
  const lines: string[] = [];
  let chars = 0;

  for (let line = startLine; line <= endLine; line++) {
    const text = linesSource.lineAt(line - 1).text;
    chars += text.length + 1;
    if (chars > maxChars) {
      lines.push(`[truncated after ${maxChars} characters]`);
      break;
    }
    lines.push(`${line}: ${text}`);
  }

  return lines.join("\n");
}

export function createVsCodeWorkspaceHost(): WorkspaceToolHost {
  const vscode = getVscode();
  return {
    root: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    readFile: (request, maxFileChars) => vscodeReadFile(vscode, request, maxFileChars),
    searchFiles: (request) => vscodeSearchFiles(vscode, request),
    replaceText: (request) => vscodeReplaceText(vscode, request),
  };
}

async function vscodeReadFile(
  vscode: typeof vscodeTypes,
  request: ReadFileRequest,
  maxFileChars: number,
): Promise<ToolResult> {
  const uri = await resolveVsCodeUri(vscode, request.path);
  if (!uri) {
    return { ok: false, content: "Path is outside the current workspace or cannot be resolved." };
  }

  try {
    const guard = await validateVsCodeTextFile(uri.fsPath);
    if (!guard.ok) return guard;
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

async function vscodeSearchFiles(vscode: typeof vscodeTypes, request: SearchFilesRequest): Promise<ToolResult> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return { ok: false, content: "No workspace is open." };
  }

  try {
    const limit = request.max_results ?? 20;
    const files = await vscode.workspace.findFiles(request.glob || "**/*", "**/{node_modules,.git,dist,out,build}/**", 200);
    const results: string[] = [];
    const matcher = createSearchMatcher(request.query);
    for (const uri of files) {
      const safeUri = await safeVsCodeFileUri(vscode, uri);
      if (!safeUri) {
        continue;
      }
      const relative = vscode.workspace.asRelativePath(safeUri, false);
      if (matcher(relative)) {
        results.push(`${relative}: file name match`);
      }
      if (results.length >= limit) break;
      await addVsCodeTextMatches(vscode, safeUri, matcher, results, limit);
      if (results.length >= limit) break;
    }
    return { ok: true, content: results.length === 0 ? "No matches." : results.join("\n") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: message };
  }
}

async function vscodeReplaceText(vscode: typeof vscodeTypes, request: ReplaceTextRequest): Promise<ToolResult> {
  const uri = await resolveVsCodeUri(vscode, request.path);
  if (!uri) {
    return { ok: false, content: "Path is outside the current workspace or cannot be resolved." };
  }

  try {
    const guard = await validateVsCodeTextFile(uri.fsPath);
    if (!guard.ok) return guard;
    const document = await vscode.workspace.openTextDocument(uri);
    const range = uniqueVsCodeTextRange(vscode, document, request.old_text);
    if (!range) {
      return { ok: false, content: "old_text must match exactly once in the file." };
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, range, request.new_text);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return { ok: false, content: "VS Code rejected the workspace edit." };
    }
    await document.save();
    return { ok: true, content: `Replaced text in ${request.path}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: message };
  }
}

async function resolveVsCodeUri(vscode: typeof vscodeTypes, requestPath: string): Promise<vscodeTypes.Uri | undefined> {
  const openDocument = findVsCodeOpenDocument(vscode, requestPath);
  if (openDocument) {
    return safeVsCodeFileUri(vscode, openDocument.uri);
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const candidate = path.isAbsolute(requestPath)
      ? path.normalize(requestPath)
      : path.normalize(path.join(folder.uri.fsPath, requestPath));
    if (isWithin(folder.uri.fsPath, candidate)) {
      return safeVsCodeFileUri(vscode, vscode.Uri.file(candidate));
    }
  }
  return undefined;
}

async function safeVsCodeFileUri(vscode: typeof vscodeTypes, uri: vscodeTypes.Uri): Promise<vscodeTypes.Uri | undefined> {
  if (uri.scheme !== "file") {
    return undefined;
  }
  const realCandidate = await realpath(uri.fsPath);
  if (!realCandidate) {
    return undefined;
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const realRoot = await realpath(folder.uri.fsPath);
    if (realRoot && isWithin(realRoot, realCandidate)) {
      return vscode.Uri.file(realCandidate);
    }
  }
  return undefined;
}

function findVsCodeOpenDocument(
  vscode: typeof vscodeTypes,
  requestPath: string,
): vscodeTypes.TextDocument | undefined {
  const normalized = path.normalize(requestPath);
  return vscode.workspace.textDocuments.find((document) => {
    if (document.uri.scheme !== "file") {
      return false;
    }
    return path.normalize(document.fileName) === normalized || vscode.workspace.asRelativePath(document.uri, false) === requestPath;
  });
}

async function addVsCodeTextMatches(
  vscode: typeof vscodeTypes,
  uri: vscodeTypes.Uri,
  matcher: (text: string) => boolean,
  results: string[],
  limit: number,
): Promise<void> {
  const guard = await validateVsCodeTextFile(uri.fsPath);
  if (!guard.ok) return;
  const document = await vscode.workspace.openTextDocument(uri);
  for (let index = 0; index < document.lineCount; index++) {
    const line = document.lineAt(index).text;
    if (!matcher(line)) {
      continue;
    }
    const relative = vscode.workspace.asRelativePath(uri, false);
    results.push(`${relative}:${index + 1}: ${line.trim().slice(0, 160)}`);
    if (results.length >= limit) {
      return;
    }
  }
}

function uniqueVsCodeTextRange(
  vscode: typeof vscodeTypes,
  document: vscodeTypes.TextDocument,
  oldText: string,
): vscodeTypes.Range | undefined {
  const text = document.getText();
  const first = text.indexOf(oldText);
  if (first < 0 || text.indexOf(oldText, first + oldText.length) >= 0) {
    return undefined;
  }
  return new vscode.Range(document.positionAt(first), document.positionAt(first + oldText.length));
}

function createSearchMatcher(query: string): (text: string) => boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return () => true;
  }
  const lower = trimmed.toLowerCase();
  const regex = searchRegex(trimmed);
  return (text) => {
    if (looksLikeEmojiSearch(trimmed) && containsEmoji(text)) {
      return true;
    }
    if (regex?.test(text)) {
      regex.lastIndex = 0;
      return true;
    }
    return text.toLowerCase().includes(lower);
  };
}

function searchRegex(query: string): RegExp | undefined {
  if (!looksLikeRegex(query)) {
    return undefined;
  }
  try {
    return new RegExp(query, "u");
  } catch {
    return undefined;
  }
}

function looksLikeRegex(query: string): boolean {
  return /[\\[\]{}()|+?^$]/.test(query);
}

function looksLikeEmojiSearch(query: string): boolean {
  return /emoji/i.test(query) || /\\u\{1F|[\p{Extended_Pictographic}️]/u.test(query);
}

function containsEmoji(text: string): boolean {
  return /[\p{Extended_Pictographic}️]/u.test(text);
}

async function realpath(filePath: string): Promise<string | undefined> {
  try {
    return await fsp.realpath(filePath);
  } catch {
    return undefined;
  }
}

async function validateVsCodeTextFile(filePath: string): Promise<ToolResult> {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) {
    return { ok: false, content: "Path is not a regular file." };
  }
  if (stat.size > MAX_TOOL_FILE_BYTES) {
    return { ok: false, content: `File is too large for Hackl tools (${stat.size} bytes, max ${MAX_TOOL_FILE_BYTES}).` };
  }
  const handle = await fsp.open(filePath, "r");
  try {
    const length = Math.min(stat.size, BINARY_SAMPLE_BYTES);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    if (looksBinary(buffer.subarray(0, bytesRead))) {
      return { ok: false, content: "Binary files are not available to Hackl tools." };
    }
    return { ok: true, content: "" };
  } finally {
    await handle.close();
  }
}

function looksBinary(sample: Buffer): boolean {
  if (sample.includes(0)) {
    return true;
  }
  return sample.toString("utf8").includes("�");
}
