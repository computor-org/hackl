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

export const TOOL_INSTRUCTIONS = ASK_TOOL_INSTRUCTIONS;

const TOOL_PREFIX = "HACKL_TOOL";

export function parseToolRequest(content: string): ToolRequest | undefined {
  const jsonText = extractToolJson(content);
  if (!jsonText) {
    return undefined;
  }

  try {
    const payload = JSON.parse(jsonText) as Record<string, unknown>;
    if (payload.name === "search_files") {
      return parseSearchFilesRequest(payload);
    }
    if (payload.name === "run_command") {
      return parseRunCommandRequest(payload);
    }
    if (payload.name !== "read_file" && payload.name !== "replace_text") {
      return undefined;
    }
    if (typeof payload.path !== "string" || !payload.path.trim()) {
      return undefined;
    }
    if (payload.name === "replace_text") {
      return parseReplaceTextRequest(payload);
    }
    return parseReadFileRequest(payload);
  } catch {
    return undefined;
  }
}

export function isPossibleToolPrefix(content: string): boolean {
  const trimmed = content.trimStart();
  return TOOL_PREFIX.startsWith(trimmed) || trimmed.startsWith(TOOL_PREFIX);
}

export function buildToolResultMessage(request: ToolRequest, result: ToolResult): string {
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

function parseReadFileRequest(payload: Record<string, unknown>): ReadFileRequest {
  return {
    name: "read_file",
    path: String(payload.path).trim(),
    start_line: positiveInteger(payload.start_line),
    end_line: positiveInteger(payload.end_line),
  };
}

function parseReplaceTextRequest(payload: Record<string, unknown>): ReplaceTextRequest | undefined {
  if (typeof payload.old_text !== "string" || payload.old_text.length === 0) {
    return undefined;
  }
  if (typeof payload.new_text !== "string") {
    return undefined;
  }
  return {
    name: "replace_text",
    path: String(payload.path).trim(),
    old_text: payload.old_text,
    new_text: payload.new_text,
  };
}

function parseSearchFilesRequest(payload: Record<string, unknown>): SearchFilesRequest | undefined {
  if (typeof payload.query !== "string" || !payload.query.trim()) {
    return undefined;
  }
  const request: SearchFilesRequest = {
    name: "search_files",
    query: payload.query.trim(),
    max_results: boundedPositiveInteger(payload.max_results, 50),
  };
  if (typeof payload.glob === "string" && payload.glob.trim()) {
    request.glob = payload.glob.trim();
  }
  return request;
}

function parseRunCommandRequest(payload: Record<string, unknown>): RunCommandRequest | undefined {
  if (typeof payload.cmd !== "string" || !payload.cmd.trim()) {
    return undefined;
  }
  const args = parseStringArray(payload.args);
  if (payload.args !== undefined && !args) {
    return undefined;
  }
  return {
    name: "run_command",
    cmd: payload.cmd.trim(),
    args,
    timeout_ms: boundedPositiveInteger(payload.timeout_ms, 600000),
  };
}

function parseStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return value;
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
