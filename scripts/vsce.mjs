import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseChannel, rootVersion } from "./release-channel.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

export function vsceArgs(action, version, useAzureCredential = false) {
  if (!["package", "publish"].includes(action)) throw new Error(`unknown vsce action: ${action}`);
  const args = ["--no-install", "vsce", action];
  if (action === "publish") args.push("--packagePath", `hackl-${version}.vsix`);
  args.push("--no-dependencies", "--allow-star-activation");
  if (releaseChannel(version) === "pre-release") args.push("--pre-release");
  if (action === "publish" && useAzureCredential) args.push("--azure-credential");
  return args;
}

export function runVsce(action, root = process.cwd()) {
  const version = rootVersion(root);
  const useAzureCredential = action === "publish" && !process.env.VSCE_PAT;
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, vsceArgs(action, version, useAzureCredential), {
    cwd: path.join(root, "packages", "vscode"),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  runVsce(process.argv[2], REPO_ROOT);
}
