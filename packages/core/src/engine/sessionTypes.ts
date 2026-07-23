export const ENGINE_SESSION_VERSION = 1;
export const ENGINE_LEASE_TIMEOUT_MS = 10_000;
export const ENGINE_HEARTBEAT_MS = 3_000;

export type EngineHostMode = "foreground" | "leased";
export type EngineClientKind = "cli" | "vscode" | "desktop" | "serve";

export interface EngineClientInfo {
  id: string;
  kind: EngineClientKind;
  pid: number;
}

export interface EngineSessionStatus {
  state: "starting" | "running-managed" | "running-external" | "stopped";
  hostMode: EngineHostMode;
  endpoint?: string;
  alias?: string;
  model?: string;
  pid?: number;
  owner?: EngineClientKind;
  leases: number;
}

export type EngineSessionRequest =
  | { version: number; action: "acquire"; client: EngineClientInfo; alias?: string }
  | { version: number; action: "heartbeat"; clientId: string }
  | { version: number; action: "release"; clientId: string }
  | { version: number; action: "status" };

export type EngineSessionReply =
  | { event: "log"; text: string }
  | { ok: true; status: EngineSessionStatus }
  | { ok: false; error: string };

export function isEngineSessionRequest(value: unknown): value is EngineSessionRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  if (typeof request.version !== "number") return false;
  if (request.action === "status") return true;
  if (request.action === "heartbeat" || request.action === "release") {
    return typeof request.clientId === "string" && request.clientId.length > 0;
  }
  if (request.action !== "acquire" || !request.client || typeof request.client !== "object") return false;
  const client = request.client as Record<string, unknown>;
  return typeof client.id === "string"
    && ["cli", "vscode", "desktop", "serve"].includes(String(client.kind))
    && typeof client.pid === "number"
    && (request.alias === undefined || typeof request.alias === "string");
}
