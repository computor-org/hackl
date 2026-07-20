import * as path from "node:path";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import { classifyCommand, commandLine } from "./commandPolicy";
import type {
  ReadFileRequest,
  ReplaceTextRequest,
  RunCommandRequest,
  SearchFilesRequest,
  ToolRequest,
  ToolResult,
} from "./tools";

export interface WorkspaceToolOptions {
  maxFileChars: number;
  allowEdits?: boolean;
  allowSearch?: boolean;
  allowCommands?: boolean;
  // Yolo: skip the command policy and per-command approval, and run commands
  // through a shell so operators and pipes work. The caller owns the risk.
  yolo?: boolean;
  // Audit sink for yolo commands. Defaults to a line on stderr so the launching
  // terminal always has a record of what ran with no approval.
  auditCommand?: (line: string) => void;
  requestApproval?: (request: ApprovalPrompt) => Promise<boolean>;
  spawnImpl?: typeof spawn;
  signal?: AbortSignal;
  workspace: WorkspaceToolHost;
}

export interface ApprovalPrompt {
  title: string;
  detail: string;
  approveLabel: string;
  denyLabel: string;
}

export interface WorkspaceToolHost {
  root(): string | undefined;
  readFile(request: ReadFileRequest, maxFileChars: number): Promise<ToolResult>;
  searchFiles(request: SearchFilesRequest): Promise<ToolResult>;
  replaceText(request: ReplaceTextRequest): Promise<ToolResult>;
}

const approvedNoGitRoots = new Set<string>();

export function createWorkspaceToolRunner(options: WorkspaceToolOptions): (request: ToolRequest) => Promise<ToolResult> {
  let noGitApproved = false;
  const workspace = options.workspace;
  if (!workspace) {
    throw new Error("createWorkspaceToolRunner requires a workspace host.");
  }
  return async (request) => {
    if (request.name === "read_file") {
      return workspace.readFile(request, options.maxFileChars);
    }
    if (request.name === "search_files") {
      if (!options.allowSearch) {
        return { ok: false, content: "search_files is only available in Work mode." };
      }
      return workspace.searchFiles(request);
    }
    if (request.name === "replace_text") {
      if (!options.allowEdits) {
        return { ok: false, content: "replace_text is only available in Edit, Work, or Agent mode." };
      }
      const approval = await requireGitApproval(workspace, options, noGitApproved);
      if (!approval.ok) return { ok: false, content: approval.content };
      noGitApproved = approval.approved;
      return workspace.replaceText(request);
    }
    if (request.name === "run_command") {
      if (!options.allowCommands) {
        return { ok: false, content: "run_command is only available in Agent mode." };
      }
      const result = await runCommand(request, workspace, options, noGitApproved);
      if (result.gitApproved) {
        noGitApproved = true;
      }
      return { ok: result.ok, content: result.content };
    }
    return { ok: false, content: "Unsupported tool." };
  };
}

async function runCommand(
  request: RunCommandRequest,
  workspace: WorkspaceToolHost,
  options: WorkspaceToolOptions,
  noGitApproved: boolean,
): Promise<ToolResult & { gitApproved?: boolean }> {
  const root = workspace.root();
  if (!root) {
    return { ok: false, content: "No workspace is open." };
  }
  if (options.yolo) {
    const auditLine = `yolo run_command: ${commandLine(request)} (cwd: ${root})`;
    if (options.auditCommand) {
      options.auditCommand(auditLine);
    } else {
      process.stderr.write(`[hackl] ${auditLine}\n`);
    }
    const result = await spawnCommand(request, root, options);
    return { ...result, gitApproved: noGitApproved };
  }
  const policy = classifyCommand(request, { workspaceRoot: root, packageScripts: packageScripts(root) });
  if (policy.decision === "deny") {
    return { ok: false, content: policy.reason };
  }
  const gitApproval = await requireGitApproval(workspace, options, noGitApproved);
  if (!gitApproval.ok) {
    return { ok: false, content: gitApproval.content, gitApproved: gitApproval.approved };
  }
  if (policy.decision === "ask") {
    const approved = await options.requestApproval?.({
      title: "Run command?",
      detail: `${commandLine(request)}\n\n${policy.reason}`,
      approveLabel: "Run",
      denyLabel: "Deny",
    });
    if (!approved) {
      return { ok: false, content: "Command denied by user.", gitApproved: gitApproval.approved };
    }
  }
  const result = await spawnCommand(request, root, options);
  return { ...result, gitApproved: gitApproval.approved };
}

function spawnCommand(request: RunCommandRequest, cwd: string, options: WorkspaceToolOptions): Promise<ToolResult> {
  return new Promise((resolve) => {
    const spawnCommandImpl = options.spawnImpl ?? spawn;
    const child = spawnCommandImpl(request.cmd, request.args ?? [], { cwd, shell: options.yolo === true });
    let done = false;
    let output = "";
    const timeout = setTimeout(() => finish(false, "Command timed out."), request.timeout_ms ?? 120000);
    const abort = () => finish(false, "Command cancelled.");
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk) => appendOutput("stderr", chunk));
    child.on("error", (error) => finish(false, error.message));
    child.on("close", (code) => finish(code === 0, `exit ${code ?? "unknown"}\n${output}`.trim()));

    function appendOutput(channel: string, chunk: Buffer): void {
      output += `${channel}: ${chunk.toString()}`;
      if (output.length > 20000) {
        output = `${output.slice(0, 20000)}\n[truncated after 20000 characters]`;
      }
    }

    function finish(ok: boolean, content: string): void {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      killChild(child);
      resolve({ ok, content });
    }
  });
}

async function requireGitApproval(
  workspace: WorkspaceToolHost,
  options: WorkspaceToolOptions,
  alreadyApproved: boolean,
): Promise<ToolResult & { approved: boolean }> {
  const root = workspace.root();
  if (!root || findGitRoot(root) || alreadyApproved || approvedNoGitRoots.has(root)) {
    return { ok: true, content: "", approved: alreadyApproved };
  }
  const approved = await options.requestApproval?.({
    title: "Workspace is not a Git repository",
    detail: "Hackl cannot rely on Git diff/history to review or recover changes in this workspace. Continue?",
    approveLabel: "Continue",
    denyLabel: "Cancel",
  });
  if (approved) {
    approvedNoGitRoots.add(root);
    return { ok: true, content: "", approved: true };
  }
  return { ok: false, content: "Action cancelled because the workspace is not a Git repository.", approved: false };
}

function findGitRoot(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function packageScripts(root: string): Set<string> {
  try {
    const raw = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    return new Set(Object.entries(parsed.scripts ?? {})
      .filter(([, value]) => typeof value === "string")
      .map(([name]) => name));
  } catch {
    return new Set();
  }
}

function killChild(child: ChildProcessWithoutNullStreams): void {
  if (!child.killed && child.exitCode === null) {
    child.kill();
  }
}
