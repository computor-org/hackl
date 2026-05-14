import type { ChatMessage } from "./chatClient";
import type { HacklTarget, ReviewContext } from "./basket";
import { ASK_TOOL_INSTRUCTIONS, EDIT_TOOL_INSTRUCTIONS, WORK_TOOL_INSTRUCTIONS, AGENT_TOOL_INSTRUCTIONS } from "./tools";

export type ConversationMessage = Pick<ChatMessage, "role" | "content">;
export type PromptMode = "ask" | "review" | "edit" | "work" | "agent";

const ASK_SYSTEM_PROMPT = [
  "Hackl. Local code helper. Terse. No edits. No long think.",
  "If selection shown, 'this/that/it' = the selection. Do not read_file unless needed.",
  "If targets are listed under 'basket:', answer over them. Anchor claims to target ids and locations.",
  "If multiple questions are listed, answer each in its own short paragraph with a leading 'Q1:' / 'Q2:' label.",
  ASK_TOOL_INSTRUCTIONS,
].join("\n");

const REVIEW_SYSTEM_PROMPT = [
  "Hackl. Local code reviewer. Terse. No edits.",
  "Produce review comments, not prose. Each comment anchors to one target file and line range.",
  "Output one fenced block ```hackl-review with a JSON array of comments. Outside that block, write at most one short summary line.",
  "Comment fields: uri (string, copy from target), startLine (int, 1-based), endLine (int, 1-based), severity (note|suggestion|warning|blocking), message (string), rationale (string, optional).",
  "Prefer actionable comments. Avoid duplicates. Skip cosmetic nits unless asked.",
  ASK_TOOL_INSTRUCTIONS,
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
  "If selection shown, 'this/that/it' = the selection.",
  WORK_TOOL_INSTRUCTIONS,
].join("\n");

const AGENT_SYSTEM_PROMPT = [
  "Hackl. Local coding agent. Terse. Inspect, edit, verify, and stop. No long think.",
  "Use Agent for multi-step file changes plus safe command checks.",
  "If selection shown, 'this/that/it' = the selection.",
  AGENT_TOOL_INSTRUCTIONS,
].join("\n");

const MAX_HISTORY_MESSAGES = 8;

export interface BuildOptions {
  targets?: HacklTarget[];
  questions?: string[];
  reviewContext?: ReviewContext;
}

export function buildHacklMessages(
  prompt: string,
  contextText: string,
  history: ConversationMessage[] = [],
  mode: PromptMode = "ask",
  options: BuildOptions = {},
): ChatMessage[] {
  const userBody = composeUserBody(prompt, contextText, options);
  return [
    { role: "system", content: systemPrompt(mode) },
    ...trimHistory(history),
    { role: "user", content: userBody },
  ];
}

export function composeUserBody(prompt: string, contextText: string, options: BuildOptions): string {
  const sections: string[] = [];
  sections.push(contextText || "[no editor context]");
  if (options.reviewContext) {
    const ctx = formatReviewContext(options.reviewContext);
    if (ctx) sections.push(ctx);
  }
  if (options.targets && options.targets.length > 0) {
    sections.push(formatTargets(options.targets));
  }
  if (options.questions && options.questions.length > 1) {
    const lines = ["questions:"];
    options.questions.forEach((q, i) => lines.push(`Q${i + 1}: ${q.trim()}`));
    sections.push(lines.join("\n"));
  }
  sections.push(prompt);
  return sections.join("\n\n");
}

function formatReviewContext(context: ReviewContext): string {
  const lines: string[] = [];
  if (context.source) lines.push(`source: ${context.source}`);
  if (context.role) lines.push(`reviewer role: ${context.role}`);
  if (context.rubricUri) lines.push(`rubric: ${context.rubricUri}`);
  if (context.externalIds) {
    const entries = Object.entries(context.externalIds).filter(([, v]) => typeof v === "string" && v);
    if (entries.length > 0) lines.push("ids: " + entries.map(([k, v]) => `${k}=${v}`).join(" "));
  }
  if (context.policyHints) {
    const entries = Object.entries(context.policyHints).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length > 0) lines.push("policy: " + entries.map(([k, v]) => `${k}=${formatScalar(v)}`).join(" "));
  }
  if (lines.length === 0) return "";
  return ["review context:", ...lines].join("\n");
}

function formatScalar(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function splitMultiQuestion(prompt: string): string[] {
  const trimmed = prompt.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const numbered = lines.every((line) => /^(\d+[.)]|[-*])\s+/.test(line));
  if (numbered && lines.length >= 2) {
    return lines.map((line) => line.replace(/^(\d+[.)]|[-*])\s+/, ""));
  }
  return [trimmed];
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
      const noteBlock = note ? `\n  reviewer note: ${note}` : "";
      return `${head}${noteBlock}\n${fence}\n${target.text}${trunc}\n\`\`\``;
    }
    case "markdown-section": {
      const heading = target.headingPath.length ? ` heading=${target.headingPath.join(" > ")}` : "";
      const head = `- id=${target.id} md ${target.relativePath}:${target.startLine}-${target.endLine}${heading} uri=${target.uri}`;
      const trunc = target.truncated ? "\n...(truncated)" : "";
      return `${head}\n\`\`\`markdown\n${target.text}${trunc}\n\`\`\``;
    }
    case "staged-changes": {
      const head = `- id=${target.id} staged-diff files=${target.files.length}`;
      const trunc = target.diffTruncated ? "\n...(diff truncated)" : "";
      return `${head}\n\`\`\`diff\n${target.diff}${trunc}\n\`\`\``;
    }
    case "diff-range": {
      const head = `- id=${target.id} diff ${target.base}..${target.head} files=${target.files.length}`;
      const trunc = target.diffTruncated ? "\n...(diff truncated)" : "";
      return `${head}\n\`\`\`diff\n${target.diff}${trunc}\n\`\`\``;
    }
    case "commit": {
      const head = `- id=${target.id} commit ${target.sha.slice(0, 12)} "${target.subject}" files=${target.files.length}`;
      const trunc = target.diffTruncated ? "\n...(diff truncated)" : "";
      return `${head}\n\`\`\`diff\n${target.diff}${trunc}\n\`\`\``;
    }
    case "diagnostic":
      return `- id=${target.id} diagnostic ${target.relativePath}:${target.startLine} severity=${target.severity} msg=${target.message}`;
  }
}

function systemPrompt(mode: PromptMode): string {
  switch (mode) {
    case "agent":
      return AGENT_SYSTEM_PROMPT;
    case "work":
      return WORK_SYSTEM_PROMPT;
    case "edit":
      return EDIT_SYSTEM_PROMPT;
    case "review":
      return REVIEW_SYSTEM_PROMPT;
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
