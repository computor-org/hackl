import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function releaseChannel(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`release version must be major.minor.patch: ${version}`);
  return Number(match[2]) % 2 === 1 ? "pre-release" : "stable";
}

export function validateGitHubRelease(version, tag, markedPrerelease) {
  const channel = releaseChannel(version);
  if (tag !== `v${version}`) throw new Error(`release tag ${tag} must match v${version}`);
  const expected = channel === "pre-release";
  if (markedPrerelease !== expected) {
    throw new Error(`${version} is ${channel}; GitHub prerelease must be ${expected}`);
  }
  return channel;
}

export function rootVersion(root = process.cwd()) {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
}

const invoked = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const [command, tag, prerelease] = process.argv.slice(2);
  if (command !== "check-github" || !tag || !["true", "false"].includes(prerelease)) {
    throw new Error("usage: release-channel.mjs check-github <tag> <true|false>");
  }
  console.log(validateGitHubRelease(rootVersion(), tag, prerelease === "true"));
}
