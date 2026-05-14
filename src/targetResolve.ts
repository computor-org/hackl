import type { HacklTarget } from "./basket";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export interface TargetRevealLocation {
  uri: string;
  startLine?: number;
  endLine?: number;
}

export function resolveTargetIdFor(
  loc: { uri: string; startLine: number; endLine: number },
  targets: readonly HacklTarget[],
): string | undefined {
  for (const t of targets) {
    if ((t.kind === "source-range" || t.kind === "markdown-section")
      && t.uri === loc.uri
      && t.startLine <= loc.startLine
      && t.endLine >= loc.endLine) {
      return t.id;
    }
  }
  for (const t of targets) {
    if ((t.kind === "source-range" || t.kind === "markdown-section") && t.uri === loc.uri) {
      return t.id;
    }
  }
  return undefined;
}

export function targetRevealLocation(target: HacklTarget): TargetRevealLocation | undefined {
  if (target.kind === "source-range" || target.kind === "markdown-section") {
    return {
      uri: target.uri,
      startLine: target.startLine,
      endLine: target.endLine,
    };
  }
  if (target.kind === "staged-changes" || target.kind === "commit") {
    const firstFile = target.files[0];
    if (!firstFile) return undefined;
    return {
      uri: pathToFileURL(path.resolve(target.workspaceRoot, firstFile)).toString(),
    };
  }
  return undefined;
}
