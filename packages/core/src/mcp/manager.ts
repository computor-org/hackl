import type { McpServerConfig } from "../types";
import type { ToolResult } from "../tools";
import type { DebugLog } from "../debugLog";

// The official @modelcontextprotocol/sdk is ESM-only. We load it via dynamic
// import() with static specifiers so esbuild bundles it from source into the
// self-contained CLI/VSIX artifacts (see the "source" export condition). The
// SDK subpaths are declared ambiently (mcp/sdk.d.ts) as `any` so the
// CommonJS tsc build does not need to resolve the package's "exports".

export interface McpToolDescriptor {
  // Qualified name surfaced to the model: mcp__<server>__<tool>.
  name: string;
  serverName: string;
  toolName: string;
  description: string;
  // One-line hint of the input parameters for the system-prompt catalog.
  inputHint: string;
}

export type McpServerState = "connected" | "disabled" | "failed";

export interface McpServerStatus {
  name: string;
  state: McpServerState;
  toolCount: number;
  error?: string;
}

export interface McpManager {
  connectAll(servers: Record<string, McpServerConfig>): Promise<void>;
  tools(): McpToolDescriptor[];
  toolNames(): ReadonlySet<string>;
  callTool(qualifiedName: string, args: Record<string, unknown>): Promise<ToolResult>;
  status(): McpServerStatus[];
  close(): Promise<void>;
}

interface Connection {
  name: string;
  client: any;
  tools: McpToolDescriptor[];
  state: McpServerState;
  error?: string;
}

const MAX_TOOL_RESULT_CHARS = 16000;

export function createMcpManager(options: { debug?: DebugLog } = {}): McpManager {
  const connections = new Map<string, Connection>();
  // qualified name -> { server, tool }
  const routing = new Map<string, { server: string; tool: string }>();

  async function connectOne(name: string, config: McpServerConfig): Promise<void> {
    if (config.enabled === false) {
      connections.set(name, { name, client: undefined, tools: [], state: "disabled" });
      return;
    }
    try {
      const client = await openClient(name, config);
      const listed = await client.listTools();
      const tools: McpToolDescriptor[] = (listed?.tools ?? []).map((tool: any) => {
        const qualified = `mcp__${name}__${tool.name}`;
        routing.set(qualified, { server: name, tool: tool.name });
        return {
          name: qualified,
          serverName: name,
          toolName: tool.name,
          description: (tool.description ?? "").trim(),
          inputHint: describeSchema(tool.inputSchema),
        };
      });
      connections.set(name, { name, client, tools, state: "connected" });
      options.debug?.("mcp.connected", { server: name, tools: tools.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      connections.set(name, { name, client: undefined, tools: [], state: "failed", error: message });
      options.debug?.("mcp.failed", { server: name, error: message });
    }
  }

  async function openClient(name: string, config: McpServerConfig): Promise<any> {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const client = new Client(
      { name: "hackl", version: "0.0.67" },
      { capabilities: {} },
    );
    const transport = await createTransport(config);
    await client.connect(transport);
    return client;
  }

  return {
    async connectAll(servers) {
      routing.clear();
      connections.clear();
      await Promise.all(
        Object.entries(servers ?? {}).map(([name, config]) => connectOne(name, config)),
      );
    },
    tools() {
      return [...connections.values()].flatMap((connection) => connection.tools);
    },
    toolNames() {
      return new Set(routing.keys());
    },
    async callTool(qualifiedName, args) {
      const route = routing.get(qualifiedName);
      if (!route) {
        return { ok: false, content: `Unknown MCP tool: ${qualifiedName}.` };
      }
      const connection = connections.get(route.server);
      if (!connection?.client) {
        return { ok: false, content: `MCP server ${route.server} is not connected.` };
      }
      try {
        const result = await connection.client.callTool({ name: route.tool, arguments: args });
        return { ok: result?.isError !== true, content: renderToolResult(result) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, content: `MCP call failed: ${message}` };
      }
    },
    status() {
      return [...connections.values()].map((connection) => ({
        name: connection.name,
        state: connection.state,
        toolCount: connection.tools.length,
        error: connection.error,
      }));
    },
    async close() {
      await Promise.all(
        [...connections.values()].map(async (connection) => {
          try {
            await connection.client?.close?.();
          } catch {
            // ignore close failures
          }
        }),
      );
      connections.clear();
      routing.clear();
    },
  };
}

async function createTransport(config: McpServerConfig): Promise<any> {
  if (config.type === "local") {
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const [command, ...args] = config.command;
    return new StdioClientTransport({
      command,
      args,
      env: { ...processEnv(), ...(config.environment ?? {}) },
    });
  }
  // Remote: prefer Streamable HTTP, fall back to SSE.
  const requestInit = config.headers ? { headers: config.headers } : undefined;
  try {
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    return new StreamableHTTPClientTransport(new URL(config.url), { requestInit });
  } catch {
    const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
    return new SSEClientTransport(new URL(config.url), { requestInit });
  }
}

// Hackl-owned provider secrets that must never be inherited by a spawned MCP
// child process. The model endpoint key in particular has no business reaching
// an unrelated tool server. Explicit per-server env still flows via
// config.environment.
const SECRET_ENV_KEYS = new Set(["HACKL_API_KEY"]);

function processEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && !SECRET_ENV_KEYS.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

function renderToolResult(result: any): string {
  const content = result?.content;
  if (typeof result?.structuredContent !== "undefined" && !Array.isArray(content)) {
    return truncate(JSON.stringify(result.structuredContent));
  }
  if (!Array.isArray(content)) {
    return truncate(typeof result === "string" ? result : JSON.stringify(result ?? ""));
  }
  const parts: string[] = [];
  for (const item of content) {
    if (item?.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    } else if (item?.type === "image") {
      parts.push(`[image ${item.mimeType ?? "binary"} omitted]`);
    } else if (item?.type === "resource") {
      const uri = item.resource?.uri ?? "resource";
      const text = item.resource?.text;
      parts.push(typeof text === "string" ? `[resource ${uri}]\n${text}` : `[resource ${uri}]`);
    } else {
      parts.push(JSON.stringify(item));
    }
  }
  return truncate(parts.join("\n").trim() || "(empty result)");
}

function describeSchema(schema: any): string {
  const props = schema?.properties;
  if (!props || typeof props !== "object") {
    return "no parameters";
  }
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];
  const entries = Object.entries(props).map(([key, value]: [string, any]) => {
    const type = value?.type ?? "any";
    const flag = required.includes(key) ? "" : "?";
    return `${key}${flag}: ${type}`;
  });
  return entries.length ? entries.join(", ") : "no parameters";
}

function truncate(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated after ${MAX_TOOL_RESULT_CHARS} characters]`;
}
