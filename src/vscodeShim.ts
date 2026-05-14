import type * as vscodeTypes from "vscode";

let cached: typeof vscodeTypes | undefined;
let override: typeof vscodeTypes | undefined;

export function getVscode(): typeof vscodeTypes {
  if (override) return override;
  if (cached) return cached;
  cached = require("vscode") as typeof vscodeTypes;
  return cached;
}

export function __setVscodeForTests(v: typeof vscodeTypes | undefined): void {
  override = v;
}
