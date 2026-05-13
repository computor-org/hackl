import * as path from "node:path";
import type { RunCommandRequest } from "./tools";

export type CommandDecision = "allow" | "ask" | "deny";

export interface CommandPolicyResult {
  decision: CommandDecision;
  reason: string;
}

export interface CommandPolicyOptions {
  workspaceRoot: string;
  packageScripts: Set<string>;
}

const HARD_DENY = new Set([
  "rm", "rmdir", "del", "erase", "format", "sudo", "su", "chmod", "chown",
  "dd", "mkfs", "diskpart", "shutdown", "reboot", "curl", "wget",
]);

const SHELL_TOKENS = ["&&", "||", ";", "|", "|&", "&", "`", "$(", ">", "<", "\n", "\r"];
const GIT_READ_ONLY = new Set(["status", "diff", "log", "show"]);
const GIT_DESTRUCTIVE = new Set(["clean", "reset", "checkout", "restore", "rm", "rebase"]);
const PACKAGE_INSTALLS = new Set(["install", "i", "add", "ci", "update", "upgrade"]);

export function classifyCommand(request: RunCommandRequest, options: CommandPolicyOptions): CommandPolicyResult {
  const command = commandName(request.cmd);
  const tokens = [request.cmd, ...(request.args ?? [])];
  if (!command) {
    return deny("Command is empty.");
  }
  if (tokens.some(hasShellToken)) {
    return deny("Shell operators and redirection are blocked.");
  }
  if (HARD_DENY.has(command)) {
    return deny(`Blocked command: ${command}.`);
  }
  const pathError = outsideWorkspacePath(tokens, options.workspaceRoot);
  if (pathError) {
    return deny(pathError);
  }
  if (command === "powershell" || command === "pwsh") {
    return deny("PowerShell snippets are blocked.");
  }
  if (command === "git") {
    return classifyGit(request.args ?? []);
  }
  if (command === "npm") {
    return classifyNpm(request.args ?? [], options.packageScripts);
  }
  return { decision: "ask", reason: "Command is not on the auto-allow list." };
}

export function commandLine(request: RunCommandRequest): string {
  return [request.cmd, ...(request.args ?? [])].join(" ");
}

function classifyGit(args: string[]): CommandPolicyResult {
  const subcommand = args.find((arg) => !arg.startsWith("-")) ?? "";
  if (GIT_READ_ONLY.has(subcommand)) {
    return { decision: "allow", reason: `Read-only git ${subcommand}.` };
  }
  if (GIT_DESTRUCTIVE.has(subcommand)) {
    return deny(`Blocked git ${subcommand}.`);
  }
  return { decision: "ask", reason: "Git command requires approval." };
}

function classifyNpm(args: string[], packageScripts: Set<string>): CommandPolicyResult {
  const [first, second] = args;
  if (PACKAGE_INSTALLS.has(first ?? "")) {
    return deny("Package install/update commands are blocked.");
  }
  if (first === "test" && packageScripts.has("test")) {
    return { decision: "allow", reason: "Declared npm test script." };
  }
  if (first === "run" && second && packageScripts.has(second)) {
    return { decision: "allow", reason: `Declared npm script: ${second}.` };
  }
  return { decision: "ask", reason: "Npm command requires approval." };
}

function outsideWorkspacePath(tokens: string[], workspaceRoot: string): string | undefined {
  for (const token of tokens.flatMap(splitPossiblePathToken)) {
    if (!looksLikePath(token)) {
      continue;
    }
    const resolved = path.isAbsolute(token) ? path.normalize(token) : path.resolve(workspaceRoot, token);
    if (!isWithin(workspaceRoot, resolved)) {
      return `Path is outside the workspace: ${token}`;
    }
  }
  return undefined;
}

function splitPossiblePathToken(token: string): string[] {
  const equals = token.indexOf("=");
  if (equals <= 0) {
    return [token];
  }
  return [token.slice(equals + 1)];
}

function looksLikePath(token: string): boolean {
  return path.isAbsolute(token) || token.startsWith(".") || token.includes("/") || token.includes("\\");
}

function hasShellToken(token: string): boolean {
  return SHELL_TOKENS.some((operator) => token.includes(operator));
}

function commandName(raw: string): string {
  const base = path.basename(raw.trim()).toLowerCase();
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, "");
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.normalize(root), candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function deny(reason: string): CommandPolicyResult {
  return { decision: "deny", reason };
}
