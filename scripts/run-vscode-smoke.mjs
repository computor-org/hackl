#!/usr/bin/env node

import { resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

await runTests({
  extensionDevelopmentPath: resolve("."),
  extensionTestsPath: resolve("tests/vscode-smoke.cjs"),
  launchArgs: ["--disable-workspace-trust"],
});
