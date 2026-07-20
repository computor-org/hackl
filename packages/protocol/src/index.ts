// The hackl client/server wire protocol. One WebSocket per session. Both the
// server and the web UI import these types, so the contract has a single source
// of truth (no codegen). Server-to-client messages reuse core SessionEvent
// verbatim, exactly as session.ts anticipated ("a future HTTP/SSE server
// forwards these verbatim").
import type { SessionEvent, ApprovalRequest, ConversationMessage, PromptMode, EngineStatus, DoctorReport, ModelEntry } from "@hackl/core";

export type { SessionEvent, ApprovalRequest, ConversationMessage, PromptMode, EngineStatus, DoctorReport, ModelEntry } from "@hackl/core";

// ---- client -> server ----

export interface PromptMessage {
  type: "prompt";
  prompt: string;
  mode: PromptMode;
  createAnnotations?: boolean;
}

export interface ApprovalResponseMessage {
  type: "approvalResponse";
  approvalId: string;
  approved: boolean;
}

export interface CancelMessage {
  type: "cancel";
}

export interface ClearMessage {
  type: "clear";
}

export interface ReadyMessage {
  type: "ready";
}

// Managed-engine control (loopback + token channel only).
export interface EngineCommandMessage {
  type: "engine";
  action: "status" | "doctor" | "list" | "up" | "down" | "restart" | "pull";
  alias?: string;
  allowRemote?: boolean;
}

export interface EngineSetMessage {
  type: "engineSet";
  key: string;
  value: string;
}

export type ClientMessage =
  | PromptMessage
  | ApprovalResponseMessage
  | CancelMessage
  | ClearMessage
  | ReadyMessage
  | EngineCommandMessage
  | EngineSetMessage;

// ---- server -> client ----

// Minted server-side: the core ApprovalRequest (title/detail/labels) plus an id
// the client echoes back in an ApprovalResponseMessage.
export interface ApprovalRequestedMessage extends ApprovalRequest {
  type: "approvalRequested";
  id: string;
}

export interface HistoryMessage {
  type: "history";
  entries: ConversationMessage[];
}

export interface ClearedMessage {
  type: "cleared";
}

export interface UserPromptMessage {
  type: "userPrompt";
  text: string;
}

// Sent on connect and whenever the resolved backend changes. Never carries the
// API key (server redacts before sending).
export interface StateMessage {
  type: "state";
  connected: boolean;
  endpoint?: string;
  model?: string;
  modes: PromptMode[];
  defaultMode: PromptMode;
  yoloAllowed: boolean;
}

export interface EngineStateMessage {
  type: "engineState";
  status: EngineStatus;
}

export interface EngineDoctorMessage {
  type: "engineDoctor";
  report: DoctorReport;
}

export interface EngineModelsMessage {
  type: "engineModels";
  models: ModelEntry[];
}

export interface EngineLogMessage {
  type: "engineLog";
  text: string;
}

export type ServerMessage =
  | SessionEvent
  | ApprovalRequestedMessage
  | HistoryMessage
  | ClearedMessage
  | UserPromptMessage
  | StateMessage
  | EngineStateMessage
  | EngineDoctorMessage
  | EngineModelsMessage
  | EngineLogMessage;

export const ALL_MODES: PromptMode[] = ["ask", "edit", "work", "agent", "yolo"];
export const DEFAULT_MODE: PromptMode = "agent";
