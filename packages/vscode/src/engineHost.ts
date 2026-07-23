import { runLeasedEngineHost } from "@hackl/core";

runLeasedEngineHost().catch((error) => {
  process.stderr.write(`hackl engine host: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
