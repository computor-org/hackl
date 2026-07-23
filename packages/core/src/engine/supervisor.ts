import * as fs from "node:fs";
import { spawn } from "node:child_process";
import type { ModelOption } from "./catalog";
import type { Knobs } from "./config";
import { samplerArgs } from "./samplers";
import { stateDir, stateFile } from "./paths";
import { writeJsonFileAtomic, readJsonFile } from "../jsonStore";

export interface EngineState {
  alias: string;
  model: string;
  host: string;
  port: number;
  pid: number;
  argv: string[];
  startedAt: string;
  managed: true;
}

// Compose the llama-server argv (binary excluded) from resolved knobs. Mirrors
// slopcode-infra/scripts/server_start_llamacpp.sh; loopback host by default and
// the built-in web UI is left enabled.
export function composeServerArgs(
  modelPath: string,
  mmprojPath: string | undefined,
  model: ModelOption | undefined,
  knobs: Knobs,
): string[] {
  const args: string[] = [
    "-m", modelPath,
    "-c", String(knobs.context),
    "-b", String(knobs.batch),
  ];
  if (knobs.ubatch) args.push("-ub", String(knobs.ubatch));
  args.push(
    "-ngl", String(knobs.ngl),
    "-fa", knobs.flashAttn ? "on" : "off",
    "--cache-type-k", knobs.cacheTypeK,
    "--cache-type-v", knobs.cacheTypeV,
    "--host", knobs.host,
    "--port", String(knobs.port),
    "--alias", knobs.servedAlias,
    "--jinja",
    "-np", String(knobs.parallel),
    "--metrics",
    "--log-timestamps",
  );
  if (knobs.noMmap) args.push("--no-mmap");
  if (knobs.fit) args.push("-fit", knobs.fit);
  if (knobs.cacheReuse > 0) args.push("--cache-reuse", String(knobs.cacheReuse));
  if (mmprojPath) {
    args.push("--mmproj", mmprojPath, knobs.mmprojOffload ? "--mmproj-offload" : "--no-mmproj-offload");
  }
  args.push(...samplerArgs(model, knobs));
  if (knobs.nCpuMoe > 0) args.push("--n-cpu-moe", String(knobs.nCpuMoe));
  if (knobs.tensorSplit) args.push("--tensor-split", knobs.tensorSplit);
  if (knobs.threads) {
    args.push("--threads", String(knobs.threads));
    if (knobs.threadsHttp) args.push("--threads-http", String(knobs.threadsHttp));
  }
  return args;
}

export interface StartOptions {
  serverBin: string;
  modelPath: string;
  mmprojPath?: string;
  model?: ModelOption;
  knobs: Knobs;
  env?: NodeJS.ProcessEnv;
  readyTimeoutMs?: number;
}

export async function startEngine(opts: StartOptions): Promise<EngineState> {
  const env = opts.env ?? process.env;
  const dir = stateDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const argv = composeServerArgs(opts.modelPath, opts.mmprojPath, opts.model, opts.knobs);
  const logFd = fs.openSync(stateFile("log", env), "a");
  const child = spawn(opts.serverBin, argv, { detached: false, stdio: ["ignore", logFd, logFd], env });
  child.on("error", () => { /* readiness below reports the launch failure */ });
  fs.closeSync(logFd);
  const pid = child.pid ?? 0;
  const state: EngineState = {
    alias: opts.model?.alias ?? "custom",
    model: opts.knobs.servedAlias,
    host: opts.knobs.host,
    port: opts.knobs.port,
    pid,
    argv: [opts.serverBin, ...argv],
    startedAt: new Date().toISOString(),
    managed: true,
  };
  writeJsonFileAtomic(stateFile("state", env), state);
  fs.writeFileSync(stateFile("pid", env), String(pid));
  fs.writeFileSync(stateFile("port", env), String(opts.knobs.port));
  try {
    await waitForReady(opts.knobs.host, opts.knobs.port, opts.readyTimeoutMs ?? 900000, () => isAlive(pid));
    return state;
  } catch (error) {
    stopEngine(env);
    throw error;
  }
}

export function readEngineState(env: NodeJS.ProcessEnv = process.env): EngineState | undefined {
  return readJsonFile<EngineState>(stateFile("state", env));
}

export function stopEngine(env: NodeJS.ProcessEnv = process.env): boolean {
  const state = readEngineState(env);
  let stopped = false;
  if (state?.pid && isAlive(state.pid)) {
    try { process.kill(state.pid, "SIGTERM"); stopped = true; } catch { /* already gone */ }
  }
  for (const name of ["pid", "port", "state"] as const) {
    try { fs.rmSync(stateFile(name, env)); } catch { /* ignore */ }
  }
  return stopped;
}

export async function stopEngineAndWait(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 5000,
): Promise<boolean> {
  const state = readEngineState(env);
  const stopped = stopEngine(env);
  if (!state?.pid || !stopped) return stopped;
  const deadline = Date.now() + timeoutMs;
  while (isAlive(state.pid) && Date.now() < deadline) await delay(50);
  if (isAlive(state.pid)) {
    try { process.kill(state.pid, "SIGKILL"); } catch { /* already gone */ }
  }
  return true;
}

export function isAlive(pid: number): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitForReady(host: string, port: number, timeoutMs: number, alive: () => boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/health`;
  while (Date.now() < deadline) {
    if (await probeOnce(url)) return;
    if (!alive()) throw new Error("llama-server exited before becoming ready (check engine.log)");
    await delay(1500);
  }
  throw new Error("timed out waiting for llama-server to become ready");
}

async function probeOnce(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok || res.status === 404; // 404 = up but no /health route
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
