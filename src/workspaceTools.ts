import * as path from "node:path";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import type * as vscodeTypes from "vscode";
import { getVscode } from "./vscodeShim";
import { classifyCommand, commandLine } from "./commandPolicy";
import type { ReadFileRequest, ReplaceTextRequest, RunCommandRequest, SearchFilesRequest, ToolRequest, ToolResult } from "./tools";
export { createNodeWorkspaceHost } from "./nodeWorkspaceHost";

export interface WorkspaceToolOptions {
  maxFileChars: number;
  allowEdits?: boolean;
  allowSearch?: boolean;
  allowCommands?: boolean;
  requestApproval?: (request: ApprovalPrompt) => Promise<boolean>;
  spawnImpl?: typeof spawn;
  signal?: AbortSignal;
  workspace?: WorkspaceToolHost;
}

export interface ApprovalPrompt {
  title: string;
  detail: string;
  approveLabel: string;
  denyLabel: string;
}

export interface WorkspaceToolHost {
  root(): string | undefined;
  readFile(request: ReadFileRequest, maxFileChars: number): Promise<ToolResult>;
  searchFiles(request: SearchFilesRequest): Promise<ToolResult>;
  replaceText(request: ReplaceTextRequest): Promise<ToolResult>;
}

const approvedNoGitRoots = new Set<string>();
const MAX_TOOL_FILE_BYTES = 1_000_000;
const BINARY_SAMPLE_BYTES = 8192;

export function createWorkspaceToolRunner(options: WorkspaceToolOptions): (request: ToolRequest) => Promise<ToolResult> {
  let noGitApproved = false;
  const workspace = options.workspace ?? createVsCodeWorkspaceHost();
  return async (request) => {
    if (request.name === "read_file") {
      return workspace.readFile(request, options.maxFileChars);
    }
    if (request.name === "search_files") {
      if (!options.allowSearch) {
        return { ok: false, content: "search_files is only available in Work mode." };
      }
      return workspace.searchFiles(request);
    }
    if (request.name === "replace_text") {
      if (!options.allowEdits) {
        return { ok: false, content: "replace_text is only available in Edit, Work, or Agent mode." };
      }
      const approval = await requireGitApproval(workspace, options, noGitApproved);
      if (!approval.ok) return { ok: false, content: approval.content };
      noGitApproved = approval.approved;
      return workspace.replaceText(request);
    }
    if (request.name === "run_command") {
      if (!options.allowCommands) {
        return { ok: false, content: "run_command is only available in Agent mode." };
      }
      const result = await runCommand(request, workspace, options, noGitApproved);
      if (result.gitApproved) {
        noGitApproved = true;
      }
      return { ok: result.ok, content: result.content };
    }
    return { ok: false, content: "Unsupported tool." };
  };
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

async function runCommand(
  request: RunCommandRequest,
  workspace: WorkspaceToolHost,
  options: WorkspaceToolOptions,
  noGitApproved: boolean,
): Promise<ToolResult & { gitApproved?: boolean }> {
  const root = workspace.root();
  if (!root) {
    return { ok: false, content: "No workspace is open." };
  }
  const policy = classifyCommand(request, { workspaceRoot: root, packageScripts: packageScripts(root) });
  if (policy.decision === "deny") {
    return { ok: false, content: policy.reason };
  }
  const gitApproval = await requireGitApproval(workspace, options, noGitApproved);
  if (!gitApproval.ok) {
    return { ok: false, content: gitApproval.content, gitApproved: gitApproval.approved };
  }
  if (policy.decision === "ask") {
    const approved = await options.requestApproval?.({
      title: "Run command?",
      detail: `${commandLine(request)}\n\n${policy.reason}`,
      approveLabel: "Run",
      denyLabel: "Deny",
    });
    if (!approved) {
      return { ok: false, content: "Command denied by user.", gitApproved: gitApproval.approved };
    }
  }
  const result = await spawnCommand(request, root, options);
  return { ...result, gitApproved: gitApproval.approved };
}

function spawnCommand(request: RunCommandRequest, cwd: string, options: WorkspaceToolOptions): Promise<ToolResult> {
  return new Promise((resolve) => {
    const spawnCommandImpl = options.spawnImpl ?? spawn;
    const child = spawnCommandImpl(request.cmd, request.args ?? [], { cwd, shell: false });
    let done = false;
    let output = "";
    const timeout = setTimeout(() => finish(false, "Command timed out."), request.timeout_ms ?? 120000);
    const abort = () => finish(false, "Command cancelled.");
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk) => appendOutput("stderr", chunk));
    child.on("error", (error) => finish(false, error.message));
    child.on("close", (code) => finish(code === 0, `exit ${code ?? "unknown"}\n${output}`.trim()));

    function appendOutput(channel: string, chunk: Buffer): void {
      output += `${channel}: ${chunk.toString()}`;
      if (output.length > 20000) {
        output = `${output.slice(0, 20000)}\n[truncated after 20000 characters]`;
      }
    }

    function finish(ok: boolean, content: string): void {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      killChild(child);
      resolve({ ok, content });
    }
  });
}

async function requireGitApproval(
  workspace: WorkspaceToolHost,
  options: WorkspaceToolOptions,
  alreadyApproved: boolean,
): Promise<ToolResult & { approved: boolean }> {
  const root = workspace.root();
  if (!root || findGitRoot(root) || alreadyApproved || approvedNoGitRoots.has(root)) {
    return { ok: true, content: "", approved: alreadyApproved };
  }
  const approved = await options.requestApproval?.({
    title: "Workspace is not a Git repository",
    detail: "Hackl cannot rely on Git diff/history to review or recover changes in this workspace. Continue?",
    approveLabel: "Continue",
    denyLabel: "Cancel",
  });
  if (approved) {
    approvedNoGitRoots.add(root);
    return { ok: true, content: "", approved: true };
  }
  return { ok: false, content: "Action cancelled because the workspace is not a Git repository.", approved: false };
}

function findGitRoot(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function packageScripts(root: string): Set<string> {
  try {
    const raw = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    return new Set(Object.entries(parsed.scripts ?? {})
      .filter(([, value]) => typeof value === "string")
      .map(([name]) => name));
  } catch {
    return new Set();
  }
}

function killChild(child: ChildProcessWithoutNullStreams): void {
  if (!child.killed && child.exitCode === null) {
    child.kill();
  }
}

function createVsCodeWorkspaceHost(): WorkspaceToolHost {
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
  return /emoji/i.test(query) || /\\u\{1F|[\p{Extended_Pictographic}\uFE0F]/u.test(query);
}

function containsEmoji(text: string): boolean {
  return /[\p{Extended_Pictographic}\uFE0F]/u.test(text);
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
  return sample.toString("utf8").includes("\uFFFD");
}
