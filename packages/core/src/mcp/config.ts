import type { McpServerConfig } from "../types";

// Normalize a loosely-typed config value (from a JSON config file or VS Code
// settings) into validated MCP server configs. Invalid entries are dropped.
export function normalizeMcpServers(value: unknown): Record<string, McpServerConfig> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const out: Record<string, McpServerConfig> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    const server = normalizeMcpServer(raw);
    if (server) {
      out[name] = server;
    }
  }
  return out;
}

function normalizeMcpServer(raw: unknown): McpServerConfig | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  if (r.type === "local" || (Array.isArray(r.command) && r.type === undefined)) {
    const command = Array.isArray(r.command)
      ? (r.command.filter((c) => typeof c === "string") as string[])
      : [];
    if (!command.length) {
      return undefined;
    }
    return {
      type: "local",
      command,
      environment: isStringMap(r.environment) ? (r.environment as Record<string, string>) : undefined,
      enabled: typeof r.enabled === "boolean" ? r.enabled : undefined,
      timeout: typeof r.timeout === "number" ? r.timeout : undefined,
    };
  }
  if (r.type === "remote" || typeof r.url === "string") {
    if (typeof r.url !== "string") {
      return undefined;
    }
    return {
      type: "remote",
      url: r.url,
      headers: isStringMap(r.headers) ? (r.headers as Record<string, string>) : undefined,
      enabled: typeof r.enabled === "boolean" ? r.enabled : undefined,
      timeout: typeof r.timeout === "number" ? r.timeout : undefined,
    };
  }
  return undefined;
}

function isStringMap(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Object.values(value as object).every((v) => typeof v === "string")
  );
}
