import * as os from "node:os";
import { spawn } from "node:child_process";

export type Accelerator = "cuda" | "metal" | "rocm" | "cpu";

export interface SystemProbe {
  platform: NodeJS.Platform;
  arch: string;
  cpuCount: number;
  totalRamGB: number;
  freeRamGB: number;
  accelerator: Accelerator;
  vramGB?: number;
  gpuName?: string;
}

const GIB = 1024 ** 3;
function gib(bytes: number): number {
  return Math.round((bytes / GIB) * 10) / 10;
}

// Parse `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits`,
// e.g. "NVIDIA GeForce RTX 4090, 24576".
export function parseNvidiaSmi(stdout: string): { vramGB: number; name: string } | undefined {
  const line = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  if (!line) return undefined;
  const parts = line.split(",").map((s) => s.trim());
  if (parts.length < 2) return undefined;
  const mib = Number(parts[parts.length - 1]);
  if (!Number.isFinite(mib) || mib <= 0) return undefined;
  return { vramGB: Math.round((mib / 1024) * 10) / 10, name: parts.slice(0, -1).join(", ") };
}

function run(cmd: string, args: string[], timeoutMs = 2500): Promise<string | undefined> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(undefined);
      return;
    }
    let out = "";
    let done = false;
    const finish = (value: string | undefined): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child?.kill(); } catch { /* ignore */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.on("error", () => finish(undefined));
    child.on("close", (code) => finish(code === 0 ? out : undefined));
  });
}

// True if `<bin> --version` spawns (the binary exists), regardless of exit code.
export function commandExists(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, ["--version"], { stdio: "ignore" });
    } catch {
      resolve(false);
      return;
    }
    let done = false;
    const finish = (v: boolean): void => { if (done) return; done = true; clearTimeout(t); try { child?.kill(); } catch { /* */ } resolve(v); };
    const t = setTimeout(() => finish(false), 2500);
    child.on("error", () => finish(false));
    child.on("close", () => finish(true));
  });
}

export async function probeSystem(): Promise<SystemProbe> {
  const base: SystemProbe = {
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length || 1,
    totalRamGB: gib(os.totalmem()),
    freeRamGB: gib(os.freemem()),
    accelerator: "cpu",
  };

  // NVIDIA (Linux/Windows/WSL).
  const smi = await run("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  if (smi) {
    const parsed = parseNvidiaSmi(smi);
    if (parsed) return { ...base, accelerator: "cuda", vramGB: parsed.vramGB, gpuName: parsed.name };
  }

  // Apple Silicon: unified memory, Metal.
  if (base.platform === "darwin" && base.arch === "arm64") {
    return { ...base, accelerator: "metal", vramGB: base.totalRamGB, gpuName: "Apple Silicon (unified memory)" };
  }

  // AMD ROCm (best effort; VRAM left undetected here).
  if (await commandExists("rocm-smi")) {
    return { ...base, accelerator: "rocm" };
  }

  return base;
}
