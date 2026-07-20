import type * as vscodeTypes from "vscode";

let override: typeof vscodeTypes | undefined;

// node's module loader already caches require("vscode"); we deliberately do not add a
// second-level cache here so that Module._load stubs in tests can re-route on every call.
export function getVscode(): typeof vscodeTypes {
  if (override) return override;
  return require("vscode") as typeof vscodeTypes;
}

export function __setVscodeForTests(v: typeof vscodeTypes | undefined): void {
  override = v;
}
