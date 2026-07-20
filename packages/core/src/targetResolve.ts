import type { AnnotationLineRange, HacklTarget } from "./types";
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
  for (const t of targets) {
    if ((t.kind === "staged-changes" || t.kind === "commit") && validDiffTargetLocation(loc, t)) {
      return t.id;
    }
  }
  return undefined;
}

export function filterAnnotationsForTargets<T extends { uri: string; startLine: number; endLine: number }>(
  annotations: readonly T[],
  targets: readonly HacklTarget[],
): { annotations: Array<T & { targetId?: string }>; dropped: number } {
  const kept: Array<T & { targetId?: string }> = [];
  let dropped = 0;
  for (const annotation of annotations) {
    const targetId = validTargetIdFor(annotation, targets);
    if (!targetId) {
      dropped += 1;
      continue;
    }
    kept.push({ ...annotation, targetId });
  }
  return { annotations: kept, dropped };
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
    const firstFile = revealFilesForTarget(target)[0];
    if (!firstFile) return undefined;
    return {
      uri: pathToFileURL(path.resolve(target.workspaceRoot, firstFile)).toString(),
    };
  }
  return undefined;
}

function validTargetIdFor(
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
    if ((t.kind === "staged-changes" || t.kind === "commit") && validDiffTargetLocation(loc, t)) {
      return t.id;
    }
  }
  return undefined;
}

function fileUrisForTarget(target: HacklTarget): Set<string> {
  if (target.kind !== "staged-changes" && target.kind !== "commit") return new Set();
  return new Set(target.files.map((file) => pathToFileURL(path.resolve(target.workspaceRoot, file)).toString()));
}

function validDiffTargetLocation(
  loc: { uri: string; startLine: number; endLine: number },
  target: HacklTarget,
): boolean {
  if (target.kind !== "staged-changes" && target.kind !== "commit") return false;
  if (!fileUrisForTarget(target).has(loc.uri)) return false;
  const ranges = annotationLineRangesForTarget(target);
  if (ranges.length === 0) return true;
  return ranges.some((range) =>
    range.uri === loc.uri &&
    range.startLine <= loc.startLine &&
    range.endLine >= loc.endLine
  );
}

function annotationLineRangesForTarget(target: HacklTarget): AnnotationLineRange[] {
  if (target.kind !== "staged-changes" && target.kind !== "commit") return [];
  const ranges = (target.metadata as { annotationLineRanges?: unknown } | undefined)?.annotationLineRanges;
  if (!Array.isArray(ranges)) return [];
  return ranges.filter((range): range is AnnotationLineRange => {
    const candidate = range as Partial<AnnotationLineRange>;
    return typeof candidate.uri === "string" &&
      typeof candidate.startLine === "number" &&
      typeof candidate.endLine === "number";
  });
}

function revealFilesForTarget(target: HacklTarget): string[] {
  if (target.kind !== "staged-changes" && target.kind !== "commit") return [];
  const revealFiles = (target.metadata as { revealFiles?: unknown } | undefined)?.revealFiles;
  if (Array.isArray(revealFiles) && revealFiles.every((file): file is string => typeof file === "string")) {
    return revealFiles;
  }
  return target.files;
}
