import * as readline from "node:readline/promises";
import { EngineManager, queryEngineSession, readEngineState } from "@hackl/core";

const out = (text: string): void => {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
};

export async function runModelsCommand(removeAlias: string | undefined, installAlias: string | undefined, yes: boolean): Promise<number> {
  const engine = new EngineManager();
  if (!removeAlias && !installAlias) {
    const active = await queryEngineSession();
    const recommended = (await engine.recommend()).primary.alias;
    const selected = engine.config().model;
    for (const model of engine.listModels()) {
      const flags = [
        model.present ? "installed" : "missing",
        model.alias === recommended ? "recommended" : "",
        model.alias === selected ? "selected" : "",
        model.alias === active?.alias ? "active" : "",
      ].filter(Boolean).join(", ");
      const size = model.sizeBytes ? formatBytes(model.sizeBytes) : `~${model.approxSizeGB} GiB`;
      out(`${model.alias.padEnd(30)} ${size.padStart(10)}  ${flags}`);
    }
    return 0;
  }

  const alias = installAlias ?? removeAlias!;
  const model = engine.listModels().find((entry) => entry.alias === alias);
  if (!model) throw new Error(`unknown model alias: ${alias}`);
  if (installAlias) {
    if (model.present) {
      out(`${alias} is already installed`);
      return 0;
    }
    const path = await engine.pull(alias, out);
    out(`installed ${alias}: ${path}`);
    return 0;
  }
  if (!model.present) throw new Error(`${alias} is not installed`);
  const session = await queryEngineSession();
  if (session?.state === "running-external") {
    throw new Error("cannot remove managed model files while an adopted external server is active");
  }
  if (session?.alias === alias) {
    throw new Error(`cannot remove ${alias} while it is active`);
  }
  const detected = await engine.status();
  if (detected.state === "running-external") {
    throw new Error("cannot remove managed model files while an adopted external server is active");
  }
  if (detected.state === "running-managed" && readEngineState()?.alias === alias) {
    throw new Error(`cannot remove ${alias} while it is active`);
  }
  if (!yes) await confirmRemove(alias, model.sizeBytes);
  const removed = engine.removeModel(alias);
  out(`removed ${alias} (${formatBytes(removed)})`);
  return 0;
}

async function confirmRemove(alias: string, size: number): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("model removal requires --yes when input is not a terminal");
  }
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Remove ${alias} (${formatBytes(size)})? [y/N] `);
    if (!/^y(es)?$/i.test(answer.trim())) throw new Error("model removal cancelled");
  } finally {
    prompt.close();
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}
