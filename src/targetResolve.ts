import type { HacklTarget } from "./basket";

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
