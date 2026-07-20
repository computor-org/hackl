import {
  EngineManager,
  applyEngineSet,
  type DoctorReport,
  type EngineStatus,
  type EngineConfig,
  type ModelEntry,
} from "@hackl/core";

const out = (s: string): void => { process.stdout.write(s.endsWith("\n") ? s : s + "\n"); };

export type EngineCommand = "doctor" | "up" | "down" | "status" | "restart" | "pull" | "model";

export const ENGINE_COMMANDS: ReadonlySet<string> = new Set<EngineCommand>([
  "doctor", "up", "down", "status", "restart", "pull", "model",
]);

export interface EngineRunOptions {
  arg?: string;       // model alias for pull/model/up
  allowRemote?: boolean;
}

// Non-interactive `hackl <command>` dispatch. Returns a process exit code.
export async function runEngineCommand(command: EngineCommand, opts: EngineRunOptions = {}): Promise<number> {
  const engine = new EngineManager();
  try {
    switch (command) {
      case "doctor":
        out(formatDoctor(await engine.doctor()));
        return 0;
      case "status":
        out(formatStatus(await engine.status()));
        return 0;
      case "up": {
        out("starting local engine...");
        const state = await engine.start({ alias: opts.arg, allowDownload: true, allowRemote: opts.allowRemote, log: out });
        out(`engine ready: ${state.alias} on http://${state.host}:${state.port}  (web UI at the same URL)`);
        return 0;
      }
      case "down":
        out(engine.stop() ? "engine stopped" : "no managed engine running");
        return 0;
      case "restart": {
        const state = await engine.restart({ alias: opts.arg, allowDownload: true, allowRemote: opts.allowRemote, log: out });
        out(`engine restarted: ${state.alias} on http://${state.host}:${state.port}`);
        return 0;
      }
      case "pull": {
        if (!opts.arg) { out("usage: hackl pull <model-alias>"); return 2; }
        const path = await engine.pull(opts.arg, out);
        out(`ready: ${path}`);
        return 0;
      }
      case "model": {
        if (!opts.arg) { out(`model: ${engine.config().model ?? "(auto by hardware)"}`); return 0; }
        return switchModel(engine, opts.arg);
      }
    }
  } catch (error) {
    process.stderr.write(`hackl: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

// REPL slash commands. Returns true if the line was an engine command.
export async function handleEngineSlash(line: string, engine: EngineManager): Promise<boolean> {
  const [cmd, ...rest] = line.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  try {
    switch (cmd) {
      case "doctor": out(formatDoctor(await engine.doctor())); return true;
      case "engine":
      case "status": out(formatStatus(await engine.status())); return true;
      case "models":
      case "ls": out(formatModels(engine.listModels())); return true;
      case "up":
      case "serve": {
        out("starting local engine...");
        const state = await engine.start({ alias: arg || undefined, allowDownload: true, log: out });
        out(`engine ready: ${state.alias} on http://${state.host}:${state.port}`);
        return true;
      }
      case "down":
      case "stop": out(engine.stop() ? "engine stopped" : "no managed engine running"); return true;
      case "restart": { const s = await engine.restart({ allowDownload: true, log: out }); out(`restarted: ${s.alias} on :${s.port}`); return true; }
      case "pull": { if (!arg) { out("usage: /pull <alias>"); return true; } out(`ready: ${await engine.pull(arg, out)}`); return true; }
      case "model": { if (!arg) { out(`model: ${engine.config().model ?? "(auto)"}`); return true; } await switchModel(engine, arg); return true; }
      case "set": out(applySet(engine, arg)); return true;
      case "reset": engine.setConfig((c) => { c.overrides = {}; c.perModel = {}; }); out("engine knobs reset to hardware defaults"); return true;
      default: return false;
    }
  } catch (error) {
    out(`error: ${error instanceof Error ? error.message : String(error)}`);
    return true;
  }
}

async function switchModel(engine: EngineManager, alias: string): Promise<number> {
  engine.setConfig((c) => { c.model = alias; });
  out(`model set to ${alias}`);
  const status = await engine.status();
  if (status.state === "running-managed") {
    out("restarting managed engine with the new model...");
    const s = await engine.restart({ alias, allowDownload: true, log: out });
    out(`engine ready: ${s.alias} on :${s.port}`);
  } else if (status.state === "running-external") {
    out("note: the current server is external (not managed by hackl); change its model where it is managed, or run `hackl down` is not applicable. Start a managed engine on another port if needed.");
  } else {
    out("run `hackl up` to start it with this model.");
  }
  return 0;
}

function applySet(engine: EngineManager, arg: string): string {
  if (!arg) return formatConfig(engine.config());
  const [key, ...rest] = arg.split(/\s+/);
  const value = rest.join(" ");
  let msg = "";
  engine.setConfig((c) => { msg = applyEngineSet(c, key, value); });
  return msg;
}

// ---- renderers ----

function formatDoctor(r: DoctorReport): string {
  const p = r.probe;
  const lines = [
    "hackl doctor",
    "",
    `machine:     ${p.platform}/${p.arch}, ${p.cpuCount} cores, ${p.totalRamGB} GiB RAM`,
    `accelerator: ${p.gpuName ?? p.accelerator}${p.vramGB ? ` (${p.vramGB} GiB)` : ""}`,
    `engine:      ${r.serverInstalled ? `llama.cpp present (${r.serverSource})` : "llama.cpp not installed (hackl up will fetch a pinned build)"}`,
    `server:      ${formatStatus(r.status)}`,
    "",
    `recommended: ${r.recommendation.primary.alias}  (${r.recommendation.budgetGB} GiB budget)`,
    `             ${r.recommendation.reason}`,
  ];
  if (r.recommendation.alternatives.length) {
    lines.push(`alternatives: ${r.recommendation.alternatives.map((m) => m.alias).join(", ")}`);
  }
  lines.push("", "notes:");
  for (const n of r.notes) lines.push(`  - ${n}`);
  lines.push("", "next: hackl up   (start the recommended model on localhost)");
  return lines.join("\n");
}

function formatStatus(s: EngineStatus): string {
  if (s.state === "stopped") return "stopped";
  const tag = s.state === "running-managed" ? "managed" : "external (adopted, read-only)";
  return `running ${tag}: ${s.endpoint}${s.model ? `  model ${s.model}` : ""}`;
}

function formatModels(models: ModelEntry[]): string {
  return models
    .map((m) => `  ${m.present ? "[x]" : "[ ]"} ${m.alias}  (~${m.approxSizeGB} GiB)${m.note ? `  - ${m.note}` : ""}`)
    .join("\n");
}

function formatConfig(cfg: EngineConfig): string {
  return JSON.stringify(cfg, null, 2);
}
