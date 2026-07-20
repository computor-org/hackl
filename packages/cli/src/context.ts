import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import type { HacklTarget } from "@hackl/core";

const MAX_TEXT_CHARS = 4000;
const MAX_DIFF_CHARS = 12000;

export interface GatherContextInput {
  cwd: string;
  prompt: string;
  staged?: boolean;
  commit?: string;
}

export interface GatheredContext {
  contextText: string;
  targets: HacklTarget[];
}

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function gatherContext(input: GatherContextInput): GatheredContext {
  const lines = [`workspace: ${input.cwd}`];
  const branch = git(input.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = git(input.cwd, ["rev-parse", "--short", "HEAD"]);
  if (branch && head) {
    lines.push(`git: ${branch} @ ${head}`);
  } else {
    lines.push("git: not a repository");
  }

  const targets: HacklTarget[] = [];
  for (const ref of fileMentions(input.prompt)) {
    const target = fileTarget(input.cwd, ref);
    if (target) targets.push(target);
  }
  if (input.staged) {
    const target = stagedTarget(input.cwd);
    if (target) targets.push(target);
  }
  if (input.commit) {
    const target = commitTarget(input.cwd, input.commit);
    if (target) targets.push(target);
  }

  return { contextText: lines.join("\n"), targets };
}

// Extract @path or @path:start-end mentions from the prompt.
export function fileMentions(prompt: string): Array<{ rel: string; start?: number; end?: number }> {
  const out: Array<{ rel: string; start?: number; end?: number }> = [];
  const pattern = /(?:^|\s)@([^\s:]+)(?::(\d+)(?:-(\d+))?)?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prompt))) {
    out.push({
      rel: match[1],
      start: match[2] ? Number(match[2]) : undefined,
      end: match[3] ? Number(match[3]) : undefined,
    });
  }
  return out;
}

function fileTarget(cwd: string, ref: { rel: string; start?: number; end?: number }): HacklTarget | undefined {
  const abs = path.resolve(cwd, ref.rel);
  if (!abs.startsWith(path.resolve(cwd))) return undefined;
  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch {
    return undefined;
  }
  const allLines = raw.split(/\r?\n/);
  const startLine = ref.start ?? 1;
  const endLine = ref.end ?? (ref.start ? ref.start : allLines.length);
  const slice = allLines.slice(Math.max(0, startLine - 1), endLine).join("\n");
  const { text, truncated } = truncate(slice);
  return {
    id: newId("src"),
    addedAt: Date.now(),
    kind: "source-range",
    uri: pathToFileURL(abs).toString(),
    languageId: languageFor(abs),
    relativePath: path.relative(cwd, abs),
    startLine,
    startCharacter: 0,
    endLine,
    endCharacter: 0,
    text,
    truncated,
  };
}

function stagedTarget(cwd: string): HacklTarget | undefined {
  const files = (git(cwd, ["diff", "--cached", "--name-only"]) ?? "").split(/\r?\n/).filter(Boolean);
  const diffRaw = git(cwd, ["diff", "--cached"]) ?? "";
  if (!files.length && !diffRaw) return undefined;
  const { diff, truncated } = truncateDiff(diffRaw);
  return {
    id: newId("staged"),
    addedAt: Date.now(),
    kind: "staged-changes",
    workspaceRoot: cwd,
    files,
    diff,
    diffTruncated: truncated,
  };
}

function commitTarget(cwd: string, sha: string): HacklTarget | undefined {
  const subject = git(cwd, ["show", "-s", "--format=%s", sha]);
  if (subject === undefined) return undefined;
  const files = (git(cwd, ["show", "--name-only", "--format=", sha]) ?? "").split(/\r?\n/).filter(Boolean);
  const diffRaw = git(cwd, ["show", "--format=", sha]) ?? "";
  const { diff, truncated } = truncateDiff(diffRaw);
  return {
    id: newId("commit"),
    addedAt: Date.now(),
    kind: "commit",
    workspaceRoot: cwd,
    sha,
    subject,
    files,
    diff,
    diffTruncated: truncated,
  };
}

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_TEXT_CHARS), truncated: true };
}

function truncateDiff(diff: string): { diff: string; truncated: boolean } {
  if (diff.length <= MAX_DIFF_CHARS) return { diff, truncated: false };
  return { diff: diff.slice(0, MAX_DIFF_CHARS), truncated: true };
}

function languageFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescriptreact", ".js": "javascript", ".jsx": "javascriptreact",
    ".py": "python", ".go": "go", ".rs": "rust", ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp",
    ".f90": "fortran", ".f": "fortran", ".java": "java", ".rb": "ruby", ".sh": "shellscript",
    ".md": "markdown", ".json": "json", ".toml": "toml", ".yaml": "yaml", ".yml": "yaml",
  };
  return map[ext] ?? "plaintext";
}
