export type ToolRequest = ReadFileRequest | ReplaceTextRequest | SearchFilesRequest | RunCommandRequest;

export interface ReadFileRequest {
  name: "read_file";
  path: string;
  start_line?: number;
  end_line?: number;
}

export interface ReplaceTextRequest {
  name: "replace_text";
  path: string;
  old_text: string;
  new_text: string;
}

export interface SearchFilesRequest {
  name: "search_files";
  query: string;
  glob?: string;
  max_results?: number;
}

export interface RunCommandRequest {
  name: "run_command";
  cmd: string;
  args?: string[];
  timeout_ms?: number;
}

export interface ToolResult {
  ok: boolean;
  content: string;
}

export const ASK_TOOL_INSTRUCTIONS = [
  "Only call HACKL_TOOL if the user asks about file contents. Else answer plainly.",
  "Files hidden. Need file? Reply ONLY:",
  'HACKL_TOOL {"name":"read_file","path":"X","start_line":1,"end_line":120}',
  "Small range. One call. Wait for HACKL_TOOL_RESULT, then answer.",
].join("\n");

export const EDIT_TOOL_INSTRUCTIONS = [
  "Use tools to inspect and edit workspace files. Make minimal normal file edits for git diff review.",
  "Need file text? Reply ONLY:",
  'HACKL_TOOL {"name":"read_file","path":"X","start_line":1,"end_line":120}',
  "To edit, reply ONLY:",
  'HACKL_TOOL {"name":"replace_text","path":"X","old_text":"exact old text","new_text":"replacement text"}',
  "replace_text must use a unique exact old_text. Wait for HACKL_TOOL_RESULT before continuing.",
].join("\n");

export const WORK_TOOL_INSTRUCTIONS = [
  "Use a small tool loop to inspect, edit, and report. Keep steps few and focused.",
  "Search first when file names or locations are uncertain:",
  'HACKL_TOOL {"name":"search_files","query":"text or file name","glob":"**/*.{ts,js}","max_results":20}',
  "Need file text? Reply ONLY:",
  'HACKL_TOOL {"name":"read_file","path":"X","start_line":1,"end_line":120}',
  "To edit, reply ONLY:",
  'HACKL_TOOL {"name":"replace_text","path":"X","old_text":"exact old text","new_text":"replacement text"}',
  "replace_text must use a unique exact old_text. No shell commands. Stop when done and summarize changed files plus verification still needed.",
].join("\n");

export const AGENT_TOOL_INSTRUCTIONS = [
  "Use a small tool loop to inspect, edit, run safe checks, and report. Keep steps few and focused.",
  "Search first when file names or locations are uncertain:",
  'HACKL_TOOL {"name":"search_files","query":"text or file name","glob":"**/*.{ts,js}","max_results":20}',
  "Need file text? Reply ONLY:",
  'HACKL_TOOL {"name":"read_file","path":"X","start_line":1,"end_line":120}',
  "To edit, reply ONLY:",
  'HACKL_TOOL {"name":"replace_text","path":"X","old_text":"exact old text","new_text":"replacement text"}',
  "To run a check, reply ONLY:",
  'HACKL_TOOL {"name":"run_command","cmd":"npm","args":["test"],"timeout_ms":120000}',
  "Commands are structured: no shell operators, no redirects, no destructive commands, no absolute outside-workspace paths.",
  "Stop when done and summarize changed files plus command results.",
].join("\n");

export const YOLO_TOOL_INSTRUCTIONS = [
  "Use a small tool loop to inspect, edit, run any command, and report. Keep steps few and focused.",
  "Search first when file names or locations are uncertain:",
  'HACKL_TOOL {"name":"search_files","query":"text or file name","glob":"**/*.{ts,js}","max_results":20}',
  "Need file text? Reply ONLY:",
  'HACKL_TOOL {"name":"read_file","path":"X","start_line":1,"end_line":120}',
  "To edit, reply ONLY:",
  'HACKL_TOOL {"name":"replace_text","path":"X","old_text":"exact old text","new_text":"replacement text"}',
  "To run any command, reply ONLY:",
  'HACKL_TOOL {"name":"run_command","cmd":"npm","args":["test"],"timeout_ms":120000}',
  "Yolo mode runs commands through a shell with no policy and no approval prompt. Shell operators and pipes are allowed: put the full command line in cmd, e.g. {\"name\":\"run_command\",\"cmd\":\"grep -r foo . | head\"}.",
  "Nothing is blocked, so double-check destructive commands before running them. Stop when done and summarize changed files plus command results.",
].join("\n");

export const TOOL_INSTRUCTIONS = ASK_TOOL_INSTRUCTIONS;

const TOOL_PREFIX = "HACKL_TOOL";

export function parseToolRequest(content: string): ToolRequest | undefined {
  const jsonText = extractToolJson(content);
  if (!jsonText) {
    return undefined;
  }

  try {
    const payload = JSON.parse(jsonText) as Record<string, unknown>;
    const name = toolName(payload.name);
    if (name === "search_files") {
      return parseSearchFilesRequest(payload);
    }
    if (name === "run_command") {
      return parseRunCommandRequest(payload);
    }
    if (name !== "read_file" && name !== "replace_text") {
      return undefined;
    }
    const path = stringValue(payload.path, payload.file, payload.filepath);
    if (!path) {
      return undefined;
    }
    if (name === "replace_text") {
      return parseReplaceTextRequest(payload, path);
    }
    return parseReadFileRequest(payload, path);
  } catch {
    return undefined;
  }
}

// A tool call whose name is not one of the typed built-ins (e.g. an MCP tool
// "mcp__server__tool"). Args are the parsed JSON object minus the "name" key.
export interface McpToolRequest {
  name: string;
  args: Record<string, unknown>;
}

export type AnyToolRequest = ToolRequest | McpToolRequest;

export const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read_file",
  "replace_text",
  "search_files",
  "run_command",
]);

export function isMcpToolRequest(request: AnyToolRequest): request is McpToolRequest {
  return !BUILTIN_TOOL_NAMES.has(request.name);
}

// Parse a HACKL_TOOL call, accepting both the typed built-ins and any extra
// (e.g. MCP) tool whose exact name is in extraNames. Built-ins win on conflict.
export function parseAnyToolRequest(content: string, extraNames?: ReadonlySet<string>): AnyToolRequest | undefined {
  const builtin = parseToolRequest(content);
  if (builtin) {
    return builtin;
  }
  if (!extraNames || extraNames.size === 0) {
    return undefined;
  }
  const jsonText = extractToolJson(content);
  if (!jsonText) {
    return undefined;
  }
  try {
    const payload = JSON.parse(jsonText) as Record<string, unknown>;
    const rawName = typeof payload.name === "string" ? payload.name.trim() : undefined;
    if (!rawName || !extraNames.has(rawName)) {
      return undefined;
    }
    const { name: _name, ...rest } = payload;
    return { name: rawName, args: rest as Record<string, unknown> };
  } catch {
    return undefined;
  }
}

export function isPossibleToolPrefix(content: string): boolean {
  const trimmed = content.trimStart();
  return TOOL_PREFIX.startsWith(trimmed) || trimmed.startsWith(TOOL_PREFIX);
}

export function buildToolResultMessage(request: AnyToolRequest, result: ToolResult): string {
  const status = result.ok ? "ok" : "error";
  const lines = [
    `HACKL_TOOL_RESULT ${request.name} ${status}`,
  ];
  if ("path" in request) {
    lines.push(`path: ${request.path}`);
  }
  lines.push("", result.content);
  return lines.join("\n");
}

function extractToolJson(content: string): string | undefined {
  const index = content.indexOf(TOOL_PREFIX);
  if (index < 0) {
    return undefined;
  }

  const start = content.indexOf("{", index + TOOL_PREFIX.length);
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let position = start; position < content.length; position++) {
    const char = content[position];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(start, position + 1);
      }
    }
  }
  return undefined;
}

function parseReadFileRequest(payload: Record<string, unknown>, path: string): ReadFileRequest {
  return {
    name: "read_file",
    path,
    start_line: positiveInteger(payload.start_line ?? payload.start ?? payload.line),
    end_line: positiveInteger(payload.end_line ?? payload.end),
  };
}

function parseReplaceTextRequest(payload: Record<string, unknown>, path: string): ReplaceTextRequest | undefined {
  const oldText = stringValue(payload.old_text, payload.old, payload.find, payload.search);
  if (oldText === undefined || oldText.length === 0) {
    return undefined;
  }
  const newText = stringValue(payload.new_text, payload.new, payload.replace, payload.replacement);
  if (newText === undefined) {
    return undefined;
  }
  return {
    name: "replace_text",
    path,
    old_text: oldText,
    new_text: newText,
  };
}

function parseSearchFilesRequest(payload: Record<string, unknown>): SearchFilesRequest | undefined {
  const query = stringValue(payload.query, payload.pattern, payload.text, payload.term, payload.q)?.trim() ?? "";
  const glob = stringValue(payload.glob, payload.path, payload.files)?.trim() ?? "";
  if (!query && !glob) {
    return undefined;
  }
  const request: SearchFilesRequest = {
    name: "search_files",
    query,
    max_results: boundedPositiveInteger(payload.max_results, 50),
  };
  if (glob) {
    request.glob = glob;
  }
  return request;
}

function parseRunCommandRequest(payload: Record<string, unknown>): RunCommandRequest | undefined {
  const cmd = stringValue(payload.cmd, payload.command);
  if (!cmd?.trim()) {
    return undefined;
  }
  const args = parseCommandArgs(payload.args);
  if (payload.args !== undefined && !args) {
    return undefined;
  }
  return {
    name: "run_command",
    cmd: cmd.trim(),
    args,
    timeout_ms: boundedPositiveInteger(payload.timeout_ms, 600000),
  };
}

function parseCommandArgs(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return splitArgs(value);
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" && typeof item !== "number")) {
    return undefined;
  }
  return value.map(String);
}

function splitArgs(value: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    args.push((match[1] ?? match[2] ?? match[0]).replace(/\\(["'\\])/g, "$1"));
  }
  return args;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

function boundedPositiveInteger(value: unknown, max: number): number | undefined {
  const parsed = positiveInteger(value);
  return parsed === undefined ? undefined : Math.min(parsed, max);
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return undefined;
}

function toolName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  const aliases: Record<string, string> = {
    read: "read_file",
    readFile: "read_file",
    search: "search_files",
    grep: "search_files",
    replace: "replace_text",
    edit: "replace_text",
    run: "run_command",
    command: "run_command",
  };
  return aliases[normalized] ?? normalized;
}
