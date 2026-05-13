export interface ToolRequest {
  name: "read_file";
  path: string;
  start_line?: number;
  end_line?: number;
}

export interface ToolResult {
  ok: boolean;
  content: string;
}

export const TOOL_INSTRUCTIONS = [
  "Files hidden. Need file? Reply ONLY:",
  'HACKL_TOOL {"name":"read_file","path":"X","start_line":1,"end_line":120}',
  "Small range. Wait for HACKL_TOOL_RESULT.",
].join("\n");

const TOOL_PREFIX = "HACKL_TOOL";

export function parseToolRequest(content: string): ToolRequest | undefined {
  const jsonText = extractToolJson(content);
  if (!jsonText) {
    return undefined;
  }

  try {
    const payload = JSON.parse(jsonText) as Record<string, unknown>;
    if (payload.name !== "read_file" || typeof payload.path !== "string" || !payload.path.trim()) {
      return undefined;
    }
    return {
      name: "read_file",
      path: payload.path.trim(),
      start_line: positiveInteger(payload.start_line),
      end_line: positiveInteger(payload.end_line),
    };
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
  return [
    `HACKL_TOOL_RESULT ${request.name} ${status}`,
    `path: ${request.path}`,
    "",
    result.content,
  ].join("\n");
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

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}
