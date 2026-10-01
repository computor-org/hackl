import type { PromptMode } from "./prompt";

export interface CoursePolicy {
  actionMode: "ask" | "edit" | "work" | "agent";
  completion: "off" | "single-line" | "multi-line";
  independentCheck: boolean;
}

export interface CourseContext {
  scope: string;
  policy: CoursePolicy;
  teachingPrompt?: string;
  assignmentContext?: string;
}

export const DISABLED_COURSE_POLICY: CoursePolicy = Object.freeze({
  actionMode: "ask", completion: "off", independentCheck: true,
});
const MODES: readonly string[] = ["ask", "edit", "work", "agent"];
const COMPLETIONS: readonly string[] = ["off", "single-line", "multi-line"];

export function validateCoursePolicy(value: unknown): CoursePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid course assistant policy");
  }
  const p = value as Record<string, unknown>;
  if (!MODES.includes(p.actionMode as string)
    || !COMPLETIONS.includes(p.completion as string)
    || typeof p.independentCheck !== "boolean") {
    throw new Error("Invalid course assistant policy");
  }
  return Object.freeze({
    actionMode: p.actionMode as CoursePolicy["actionMode"],
    completion: p.completion as CoursePolicy["completion"],
    independentCheck: p.independentCheck,
  });
}

export function courseAllowsMode(policy: CoursePolicy | undefined, mode: PromptMode): boolean {
  if (!policy) return MODES.includes(mode) || mode === "yolo";
  if (policy.independentCheck || mode === "yolo") return false;
  const requested = MODES.indexOf(mode);
  return requested >= 0 && requested <= MODES.indexOf(policy.actionMode);
}

export function courseCompletion(policy?: CoursePolicy): CoursePolicy["completion"] {
  return policy?.independentCheck ? "off" : policy?.completion ?? "multi-line";
}

// All MCP tools are disabled while a host policy applies. Their descriptions and
// annotations are untrusted and cannot establish a read-only authorization.
export function courseAllowsMcp(policy?: CoursePolicy): boolean {
  return policy === undefined;
}

export function limitCourseCompletion(text: string, policy?: CoursePolicy): string {
  const completion = courseCompletion(policy);
  if (completion === "off") return "";
  return completion === "single-line" ? text.split(/\r?\n/)[0] : text;
}

export function courseAllowsRead(file: string, allowed: readonly string[] = []): boolean {
  const normalized = file.replace(/\\/g, "/");
  if (!normalized || normalized.split("/").some(s => s.startsWith("."))) return false;
  return allowed.some(p => p.replace(/\\/g, "/") === normalized);
}
