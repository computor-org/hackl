import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { createCommitTarget, createStagedChangesTarget, HacklTarget } from "./basket";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

function firstWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export async function buildStagedChangesTarget(): Promise<HacklTarget | { error: string }> {
  const root = firstWorkspaceRoot();
  if (!root) return { error: "No workspace folder open." };
  try {
    const diff = await git(root, ["diff", "--staged"]);
    if (!diff.trim()) return { error: "No staged changes." };
    const namesOutput = await git(root, ["diff", "--staged", "--name-only"]);
    const statusOutput = await git(root, ["diff", "--staged", "--name-status", "-z", "-M"]);
    const files = namesOutput.split(/\r?\n/).filter(Boolean);
    return createStagedChangesTarget({
      workspaceRoot: root,
      files,
      revealFiles: revealFilesFromNameStatus(statusOutput),
      diff,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function buildLastCommitTarget(): Promise<HacklTarget | { error: string }> {
  const root = firstWorkspaceRoot();
  if (!root) return { error: "No workspace folder open." };
  try {
    const shaOut = await git(root, ["rev-parse", "HEAD"]);
    const sha = shaOut.trim();
    const subjectOut = await git(root, ["log", "-1", "--pretty=%s", sha]);
    const filesOut = await git(root, ["show", "--name-only", "--pretty=", sha]);
    const files = filesOut.split(/\r?\n/).filter(Boolean);
    const statusOut = await git(root, ["diff-tree", "--no-commit-id", "--name-status", "-z", "-r", "-M", sha]);
    const diff = await git(root, ["show", "--no-color", sha]);
    return createCommitTarget({
      workspaceRoot: root,
      sha,
      subject: subjectOut.trim(),
      files,
      revealFiles: revealFilesFromNameStatus(statusOut),
      diff,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function revealFilesFromNameStatus(output: string): string[] {
  const parts = output.split("\0").filter(Boolean);
  const files: string[] = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    if (!status) break;
    const code = status[0];
    if (code === "R" || code === "C") {
      i += 1;
      const newPath = parts[i++];
      if (newPath) files.push(newPath);
      continue;
    }
    const file = parts[i++];
    if (code !== "D" && file) files.push(file);
  }
  return files;
}
