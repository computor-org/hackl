import * as vscode from "vscode";
import type { DebugLog } from "@hackl/core";
export type { DebugLog } from "@hackl/core";

let output: vscode.OutputChannel | undefined;

export function createDebugLog(enabled: boolean): DebugLog | undefined {
  if (!enabled) {
    return undefined;
  }
  if (!output) {
    output = vscode.window.createOutputChannel("Hackl Debug");
  }
  return (event, data) => {
    const line = `[${new Date().toISOString()}] ${event}${data === undefined ? "" : ` ${formatData(data)}`}`;
    output?.appendLine(line);
    console.log(`[Hackl Debug] ${event}`, data ?? "");
  };
}

export function disposeDebugLog(): void {
  output?.dispose();
  output = undefined;
}

function formatData(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}
