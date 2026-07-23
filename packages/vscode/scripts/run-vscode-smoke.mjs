#!/usr/bin/env node

import { resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

process.env.HACKL_TEST_DISABLE_ENGINE = "1";

await runTests({
  extensionDevelopmentPath: resolve("."),
  extensionTestsPath: resolve("tests/vscode-smoke.cjs"),
  launchArgs: ["--disable-workspace-trust"],
});
