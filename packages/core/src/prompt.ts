import type { ChatMessage } from "./chatClient";
import type { HacklTarget } from "./types";
import { ASK_TOOL_INSTRUCTIONS, EDIT_TOOL_INSTRUCTIONS, WORK_TOOL_INSTRUCTIONS, AGENT_TOOL_INSTRUCTIONS, YOLO_TOOL_INSTRUCTIONS } from "./tools";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export type ConversationMessage = Pick<ChatMessage, "role" | "content">;
export type PromptMode = "ask" | "edit" | "work" | "agent" | "yolo";

const ASK_SYSTEM_PROMPT = [
  "Hackl. Local code helper. Terse. No edits. No long think.",
  "If selection shown, 'this/that/it' = the selection. Do not read_file unless needed.",
  "If targets are listed under 'basket:', answer over them. Anchor claims to target ids and locations.",
  ASK_TOOL_INSTRUCTIONS,
].join("\n");

const ANNOTATION_OUTPUT_INSTRUCTIONS = [
  "annotations requested: in addition to your chat answer, emit exactly one fenced block tagged ```hackl-annotations containing JSON only.",
  "Each annotation: { uri (copy from a source/Markdown target or staged/commit fileUris entry), startLine (1-based int), endLine (1-based int), severity (note|suggestion|warning|blocking), message, rationale? }.",
  "Anchor each annotation to one target's uri and lines. Prefer actionable, non-duplicate annotations. If you have nothing concrete to anchor, emit [].",
].join("\n");

const EDIT_SYSTEM_PROMPT = [
  "Hackl. Local code editor. Terse. Make requested edits. No long think.",
  "If selection shown, 'this/that/it' = the selection. Read files before editing when needed.",
  "If targets are listed under 'basket:', edits must correspond to them.",
  EDIT_TOOL_INSTRUCTIONS,
].join("\n");

const WORK_SYSTEM_PROMPT = [
  "Hackl. Local coding worker. Terse. Inspect, edit, and stop. No long think.",
  "Use Work for multi-step file changes. Do not run shell commands or claim tests ran.",
  "The ctx block is editor metadata and selection only, not the workspace inventory. Never infer file contents from a filename.",
  "For workspace-orientation questions (what/where is this place, directory, project, or workspace; list/show files), inspect first with search_files using an empty query and glob **/*.",
  "If selection shown, 'this/that/it' = the selection.",
  WORK_TOOL_INSTRUCTIONS,
].join("\n");

const AGENT_SYSTEM_PROMPT = [
  "Hackl. Local coding agent. Terse. Inspect, edit, verify, and stop. No long think.",
  "Use Agent for multi-step file changes plus safe command checks.",
  "The ctx block is editor metadata and selection only, not the workspace inventory. Never infer file contents from a filename.",
  "For workspace-orientation questions (what/where is this place, directory, project, or workspace; list/show files), inspect first with search_files using an empty query and glob **/*.",
  "If selection shown, 'this/that/it' = the selection.",
  AGENT_TOOL_INSTRUCTIONS,
].join("\n");

const YOLO_SYSTEM_PROMPT = [
  "Hackl. Local coding agent, unrestricted. Terse. Inspect, edit, run any command, verify, and stop. No long think.",
  "Yolo mode: the command policy and per-command approval are off. You may run any shell command, including pipes and redirects.",
  "The ctx block is editor metadata and selection only, not the workspace inventory. Never infer file contents from a filename.",
  "For workspace-orientation questions (what/where is this place, directory, project, or workspace; list/show files), inspect first with search_files using an empty query and glob **/*.",
  "The user accepted full responsibility for this mode. Prefer the least destructive command that does the job and explain anything irreversible before you run it.",
  "If selection shown, 'this/that/it' = the selection.",
  YOLO_TOOL_INSTRUCTIONS,
].join("\n");

const MAX_HISTORY_MESSAGES = 8;

export interface BuildOptions {
  targets?: HacklTarget[];
  createAnnotations?: boolean;
  // Rendered catalog of extra (MCP) tools, appended to the system prompt.
  toolCatalog?: string;
}

export function buildHacklMessages(
  prompt: string,
  contextText: string,
  history: ConversationMessage[] = [],
  mode: PromptMode = "ask",
  options: BuildOptions = {},
): ChatMessage[] {
  const userBody = composeUserBody(prompt, contextText, options);
  const system = options.toolCatalog
    ? `${systemPrompt(mode)}\n${options.toolCatalog}`
    : systemPrompt(mode);
  return [
    { role: "system", content: system },
    ...trimHistory(history),
    { role: "user", content: userBody },
  ];
}

export function composeUserBody(prompt: string, contextText: string, options: BuildOptions): string {
  const sections: string[] = [];
  sections.push(contextText || "[no editor context]");
  if (options.targets && options.targets.length > 0) {
    sections.push(formatTargets(options.targets));
  }
  if (options.createAnnotations) {
    sections.push(ANNOTATION_OUTPUT_INSTRUCTIONS);
  }
  sections.push(prompt);
  return sections.join("\n\n");
}

function formatTargets(targets: HacklTarget[]): string {
  const lines = ["basket:"];
  for (const target of targets) {
    lines.push(formatTarget(target));
  }
  return lines.join("\n");
}

function formatTarget(target: HacklTarget): string {
  switch (target.kind) {
    case "source-range": {
      const head = `- id=${target.id} src ${target.relativePath}:${target.startLine}-${target.endLine} (${target.languageId}) uri=${target.uri}`;
      const fence = "```" + (target.languageId || "");
      const trunc = target.truncated ? "\n...(truncated)" : "";
      const note = (target.metadata as { note?: string } | undefined)?.note;
      const noteBlock = note ? `\n  annotation note: ${note}` : "";
      return `${head}${noteBlock}\n${fence}\n${target.text}${trunc}\n\`\`\``;
    }
    case "markdown-section": {
      const heading = target.headingPath.length ? ` heading=${target.headingPath.join(" > ")}` : "";
      const head = `- id=${target.id} md ${target.relativePath}:${target.startLine}-${target.endLine}${heading} uri=${target.uri}`;
      const trunc = target.truncated ? "\n...(truncated)" : "";
      return `${head}\n\`\`\`markdown\n${target.text}${trunc}\n\`\`\``;
    }
    case "staged-changes": {
      const files = formatWorkspaceFiles(target.workspaceRoot, target.files);
      const head = `- id=${target.id} staged-diff files=${target.files.length} truncated=${target.diffTruncated ? "yes" : "no"} workspace=${target.workspaceRoot}${files}`;
      const trunc = target.diffTruncated ? "\n...(diff truncated)" : "";
      return `${head}\n\`\`\`diff\n${target.diff}${trunc}\n\`\`\``;
    }
    case "commit": {
      const files = formatWorkspaceFiles(target.workspaceRoot, target.files);
      const head = `- id=${target.id} commit ${target.sha.slice(0, 12)} "${target.subject}" files=${target.files.length} truncated=${target.diffTruncated ? "yes" : "no"} workspace=${target.workspaceRoot}${files}`;
      const trunc = target.diffTruncated ? "\n...(diff truncated)" : "";
      return `${head}\n\`\`\`diff\n${target.diff}${trunc}\n\`\`\``;
    }
  }
}

function formatWorkspaceFiles(workspaceRoot: string, files: string[]): string {
  if (files.length === 0) return "";
  const formatted = files
    .slice(0, 20)
    .map((file) => {
      const fullPath = path.resolve(workspaceRoot, file);
      return `${file} uri=${pathToFileURL(fullPath).toString()}`;
    })
    .join(", ");
  const suffix = files.length > 20 ? ", ..." : "";
  return ` fileUris=[${formatted}${suffix}]`;
}

function systemPrompt(mode: PromptMode): string {
  switch (mode) {
    case "yolo":
      return YOLO_SYSTEM_PROMPT;
    case "agent":
      return AGENT_SYSTEM_PROMPT;
    case "work":
      return WORK_SYSTEM_PROMPT;
    case "edit":
      return EDIT_SYSTEM_PROMPT;
    default:
      return ASK_SYSTEM_PROMPT;
  }
}

function trimHistory(history: ConversationMessage[]): ChatMessage[] {
  return history
    .filter((message): message is ChatMessage => isChatRole(message.role) && message.content.trim() !== "")
    .slice(-MAX_HISTORY_MESSAGES);
}

function isChatRole(role: string): role is ChatMessage["role"] {
  return role === "user" || role === "assistant" || role === "system";
}
