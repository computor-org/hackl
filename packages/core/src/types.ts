// Shared value types used across the Hackl backend and every frontend
// (VS Code extension, CLI, future GUI/webui). No runtime imports: types only.

// --- Context targets (the "basket") ---

export interface BaseTarget {
  id: string;
  addedAt: number;
  metadata?: Record<string, unknown>;
}

export interface SourceRangeTarget extends BaseTarget {
  kind: "source-range";
  uri: string;
  languageId: string;
  relativePath: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  text: string;
  truncated: boolean;
}

export interface MarkdownSectionTarget extends BaseTarget {
  kind: "markdown-section";
  uri: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  headingPath: string[];
  text: string;
  truncated: boolean;
}

export interface StagedChangesTarget extends BaseTarget {
  kind: "staged-changes";
  workspaceRoot: string;
  files: string[];
  diff: string;
  diffTruncated: boolean;
}

export interface CommitTarget extends BaseTarget {
  kind: "commit";
  workspaceRoot: string;
  sha: string;
  subject: string;
  files: string[];
  diff: string;
  diffTruncated: boolean;
}

export type HacklTarget =
  | SourceRangeTarget
  | StagedChangesTarget
  | CommitTarget
  | MarkdownSectionTarget;

export interface BasketSnapshot {
  targets: HacklTarget[];
}

export interface AnnotationLineRange {
  uri: string;
  startLine: number;
  endLine: number;
}

// --- Annotations (code-review comments) ---

export type AnnotationSeverity = "note" | "suggestion" | "warning" | "blocking";
export type AnnotationStatus = "open" | "resolved" | "dismissed";

export interface HacklAnnotation {
  id: string;
  // Creation-time hint only. Re-resolve from basket via resolveTargetIdFor when needed;
  // do not trust this field after the basket has changed.
  targetId?: string;
  uri: string;
  startLine: number;
  endLine: number;
  severity: AnnotationSeverity;
  message: string;
  rationale?: string;
  status: AnnotationStatus;
  authorType: "human" | "ai";
  aiModel?: string;
  createdAt: number;
}

export type AnnotationAuthor = Pick<HacklAnnotation, "authorType" | "aiModel">;

// --- MCP configuration (opencode-shaped discriminated union) ---

export interface McpLocalConfig {
  type: "local";
  command: string[];
  environment?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

export interface McpRemoteConfig {
  type: "remote";
  url: string;
  headers?: Record<string, string>;
  oauth?: { clientId?: string; clientSecret?: string; scope?: string } | false;
  enabled?: boolean;
  timeout?: number;
}

export type McpServerConfig = McpLocalConfig | McpRemoteConfig;

// --- Resolved configuration shared by all frontends ---

export interface AutocompleteConfig {
  enabled: boolean;
  endpoint: string;
  endpointConfigured: boolean;
  model: string;
  maxTokens: number;
  debounceMs: number;
  multiLine: boolean;
  maxPredictMs: number;
}

export interface HacklConfig {
  endpoint: string;
  endpointConfigured: boolean;
  apiKey: string;
  model: string;
  maxToolFileChars: number;
  maxToolCalls: number;
  maxContextTokens: number;
  maxContextTokensConfigured: boolean;
  enableThinking: boolean;
  reasoningBudget: number;
  debug: boolean;
  persistSessions: boolean;
  codexEnabled: boolean;
  codexCommand: string;
  codexModel: string;
  autocomplete: AutocompleteConfig;
  mcp: Record<string, McpServerConfig>;
}
