import type { McpToolDescriptor } from "./mcp/manager";

// Render the dynamic (MCP) tool catalog for injection into the system prompt so
// the model can call them through the same HACKL_TOOL text protocol as the
// built-ins. Built-in tool instructions are emitted separately by prompt.ts.
export function renderToolCatalog(tools: McpToolDescriptor[]): string {
  if (!tools.length) {
    return "";
  }
  const lines = ["Extra tools (MCP). Call exactly like built-ins, parameters as top-level JSON keys:"];
  for (const tool of tools) {
    const description = tool.description ? ` ${firstLine(tool.description)}` : "";
    lines.push(`HACKL_TOOL {"name":"${tool.name}", ...}  params: ${tool.inputHint}.${description}`);
  }
  lines.push("Wait for HACKL_TOOL_RESULT before continuing.");
  return lines.join("\n");
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0].trim();
  return line.length > 160 ? `${line.slice(0, 160)}...` : line;
}
