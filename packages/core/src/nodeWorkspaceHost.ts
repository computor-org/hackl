import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { ReadFileRequest, ReplaceTextRequest, SearchFilesRequest, ToolResult } from "./tools";
import type { WorkspaceToolHost } from "./toolRunner";

const MAX_TOOL_FILE_BYTES = 1_000_000;
const BINARY_SAMPLE_BYTES = 8192;

export function createNodeWorkspaceHost(root: string, spawnImpl: typeof spawn = spawn): WorkspaceToolHost {
  const workspaceRoot = realpathSync(path.resolve(root)) ?? path.resolve(root);
  return {
    root: () => workspaceRoot,
    readFile: (request, maxFileChars) => nodeReadFile(workspaceRoot, request, maxFileChars),
    searchFiles: (request) => nodeSearchFiles(workspaceRoot, request, spawnImpl),
    replaceText: (request) => nodeReplaceText(workspaceRoot, request),
  };
}

async function nodeReadFile(root: string, request: ReadFileRequest, maxFileChars: number): Promise<ToolResult> {
  const filePath = resolveNodePath(root, request.path);
  if (!filePath) {
    return { ok: false, content: "Path is outside the current workspace or cannot be resolved." };
  }

  try {
    const guard = await validateTextFile(filePath);
    if (!guard.ok) return guard;
    const text = await fsp.readFile(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    const source = {
      lineCount: lines.length,
      lineAt: (line: number) => ({ text: lines[line] ?? "" }),
    };
    const start = Math.max(1, request.start_line ?? 1);
    const end = Math.min(source.lineCount, Math.max(start, request.end_line ?? Math.min(start + 119, source.lineCount)));
    return { ok: true, content: readLineRange(source, start, end, maxFileChars) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: message };
  }
}

async function nodeReplaceText(root: string, request: ReplaceTextRequest): Promise<ToolResult> {
  const filePath = resolveNodePath(root, request.path);
  if (!filePath) {
    return { ok: false, content: "Path is outside the current workspace or cannot be resolved." };
  }

  try {
    const guard = await validateTextFile(filePath);
    if (!guard.ok) return guard;
    const text = await fsp.readFile(filePath, "utf8");
    const first = text.indexOf(request.old_text);
    if (first < 0 || text.indexOf(request.old_text, first + request.old_text.length) >= 0) {
      return { ok: false, content: "old_text must match exactly once in the file." };
    }
    const updated = text.slice(0, first) + request.new_text + text.slice(first + request.old_text.length);
    await fsp.writeFile(filePath, updated, "utf8");
    return { ok: true, content: `Replaced text in ${request.path}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: message };
  }
}

async function nodeSearchFiles(
  root: string,
  request: SearchFilesRequest,
  spawnImpl: typeof spawn,
): Promise<ToolResult> {
  try {
    const files = await listNodeFiles(root, request.glob, spawnImpl);
    const matcher = createSearchMatcher(request.query);
    const listOnly = request.query.trim() === "";
    const limit = request.max_results ?? 20;
    const results: string[] = [];
    for (const relative of files) {
      if (matcher(relative)) {
        results.push(`${relative}: file name match`);
      }
      if (results.length >= limit) break;
      if (listOnly) continue;
      await addNodeTextMatches(root, relative, matcher, results, limit);
      if (results.length >= limit) break;
    }
    return { ok: true, content: results.length === 0 ? "No matches." : results.join("\n") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: message };
  }
}

async function listNodeFiles(root: string, glob: string | undefined, spawnImpl: typeof spawn): Promise<string[]> {
  const rg = await runRgFiles(root, glob, spawnImpl);
  if (rg) {
    return rg;
  }
  const files = await walkFiles(root);
  return files.filter((file) => matchesSimpleGlob(file, glob));
}

function runRgFiles(root: string, glob: string | undefined, spawnImpl: typeof spawn): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    const args = ["--files"];
    if (glob?.trim()) {
      args.push("-g", glob.trim());
    }
    const child = spawnImpl("rg", args, { cwd: root, shell: false });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output.split(/\r?\n/).filter(Boolean).slice(0, 200));
      } else {
        resolve(undefined);
      }
    });
  });
}

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if ([".git", "node_modules", "dist", "out", "build"].includes(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, fullPath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, fullPath));
    }
    if (files.length >= 200) {
      break;
    }
  }
  return files;
}

async function addNodeTextMatches(
  root: string,
  relative: string,
  matcher: (text: string) => boolean,
  results: string[],
  limit: number,
): Promise<void> {
  const filePath = resolveNodePath(root, relative);
  if (!filePath) return;
  let text: string;
  try {
    const guard = await validateTextFile(filePath);
    if (!guard.ok) return;
    text = await fsp.readFile(filePath, "utf8");
  } catch {
    return;
  }
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!matcher(line)) {
      continue;
    }
    results.push(`${relative}:${index + 1}: ${line.trim().slice(0, 160)}`);
    if (results.length >= limit) {
      return;
    }
  }
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

function resolveNodePath(root: string, requestPath: string): string | undefined {
  const candidate = path.isAbsolute(requestPath)
    ? path.normalize(requestPath)
    : path.normalize(path.join(root, requestPath));
  if (!isWithin(root, candidate)) {
    return undefined;
  }
  const realCandidate = realpathSync(candidate);
  return realCandidate && isWithin(root, realCandidate) ? realCandidate : undefined;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.normalize(root), candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realpathSync(filePath: string): string | undefined {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return undefined;
  }
}

async function validateTextFile(filePath: string): Promise<ToolResult> {
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

function matchesSimpleGlob(file: string, glob: string | undefined): boolean {
  if (!glob || glob === "**/*") {
    return true;
  }
  const pattern = globToRegExp(glob);
  return pattern.test(file);
}

function globToRegExp(glob: string): RegExp {
  let output = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        output += ".*";
        index += 1;
      } else {
        output += "[^/]*";
      }
    } else if (char === "{") {
      const end = glob.indexOf("}", index + 1);
      if (end > index) {
        output += `(${glob.slice(index + 1, end).split(",").map(escapeRegExp).join("|")})`;
        index = end;
      } else {
        output += "\\{";
      }
    } else {
      output += escapeRegExp(char);
    }
  }
  return new RegExp(`^${output}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
