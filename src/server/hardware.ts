import * as os from "node:os";
import { spawn } from "node:child_process";
import { HardwareProfile, GpuBackend } from "./recommend";

const PROBE_TIMEOUT_MS = 1500;

export async function detectHardware(): Promise<HardwareProfile> {
  const platform = normPlatform(process.platform);
  const arch = normArch(process.arch);
  const totalRamBytes = os.totalmem();
  const freeRamBytes = os.freemem();
  const physicalCores = countPhysicalCores();
  const base: HardwareProfile = {
    platform,
    arch,
    totalRamBytes,
    freeRamBytes,
    physicalCores,
    backend: "cpu",
    unifiedMemory: false,
  };
  if (platform === "darwin") {
    return await detectDarwin(base);
  }
  if (platform === "linux") {
    return await detectLinux(base);
  }
  return await detectWindows(base);
}

function normPlatform(p: NodeJS.Platform): HardwareProfile["platform"] {
  if (p === "darwin") return "darwin";
  if (p === "win32") return "win32";
  return "linux";
}

function normArch(a: string): HardwareProfile["arch"] {
  return a === "arm64" ? "arm64" : "x64";
}

function countPhysicalCores(): number {
  const cpus = os.cpus();
  return Math.max(1, cpus.length);
}

async function detectDarwin(base: HardwareProfile): Promise<HardwareProfile> {
  const apple = base.arch === "arm64";
  let vramTotal: number | undefined;
  if (apple) {
    const wired = await run("sysctl", ["-n", "iogpu.wired_limit_mb"]).catch(() => "");
    const mb = Number.parseInt(wired.trim(), 10);
    if (Number.isFinite(mb) && mb > 0) {
      vramTotal = mb * 1024 * 1024;
    } else {
      vramTotal = Math.floor(base.totalRamBytes * 0.67);
    }
  }
  const sp = await run("system_profiler", ["SPDisplaysDataType", "-json"]).catch(() => "");
  const gpuName = parseAppleGpuName(sp);
  return {
    ...base,
    backend: apple ? "metal" : "cpu",
    gpuVendor: apple ? "apple" : undefined,
    gpuName,
    vramTotalBytes: vramTotal,
    vramFreeBytes: vramTotal,
    unifiedMemory: apple,
  };
}

async function detectLinux(base: HardwareProfile): Promise<HardwareProfile> {
  const nv = await run("nvidia-smi", [
    "--query-gpu=name,memory.total,memory.free",
    "--format=csv,noheader,nounits",
  ]).catch(() => "");
  const nvGpu = parseNvidiaSmi(nv);
  if (nvGpu) {
    return { ...base, backend: "cuda", gpuVendor: "nvidia", ...nvGpu };
  }
  const rocm = await run("rocm-smi", ["--showmeminfo", "vram", "--json"]).catch(() => "");
  const amdGpu = parseRocmSmi(rocm);
  if (amdGpu) {
    return { ...base, backend: "rocm", gpuVendor: "amd", ...amdGpu };
  }
  // Vulkan fallback when no vendor tool is on PATH: leave VRAM unknown.
  return base;
}

async function detectWindows(base: HardwareProfile): Promise<HardwareProfile> {
  const nv = await run("nvidia-smi", [
    "--query-gpu=name,memory.total,memory.free",
    "--format=csv,noheader,nounits",
  ]).catch(() => "");
  const nvGpu = parseNvidiaSmi(nv);
  if (nvGpu) {
    return { ...base, backend: "cuda", gpuVendor: "nvidia", ...nvGpu };
  }
  const ps = await run("powershell", [
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json",
  ]).catch(() => "");
  const winGpu = parseWinGpu(ps);
  if (winGpu) {
    return { ...base, backend: "vulkan", ...winGpu };
  }
  return base;
}

export function parseNvidiaSmi(out: string): { gpuName: string; vramTotalBytes: number; vramFreeBytes: number } | undefined {
  const line = out.split("\n").map((s) => s.trim()).find((s) => s.length > 0);
  if (!line) return undefined;
  const parts = line.split(",").map((s) => s.trim());
  if (parts.length < 3) return undefined;
  const [name, totalMb, freeMb] = parts;
  const total = Number.parseFloat(totalMb);
  const free = Number.parseFloat(freeMb);
  if (!Number.isFinite(total) || !Number.isFinite(free)) return undefined;
  return {
    gpuName: name,
    vramTotalBytes: Math.round(total * 1024 * 1024),
    vramFreeBytes: Math.round(free * 1024 * 1024),
  };
}

export function parseRocmSmi(out: string): { gpuName: string; vramTotalBytes: number; vramFreeBytes: number } | undefined {
  if (!out.trim()) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(out);
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null) return undefined;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!key.toLowerCase().startsWith("card")) continue;
    if (typeof value !== "object" || value === null) continue;
    const card = value as Record<string, unknown>;
    const total = pickNumber(card, ["VRAM Total Memory (B)", "vram_total_bytes"]);
    const used = pickNumber(card, ["VRAM Total Used Memory (B)", "vram_used_bytes"]);
    if (total === undefined) continue;
    const free = used !== undefined ? Math.max(0, total - used) : total;
    return {
      gpuName: String(card["Card series"] ?? card["GFX Version"] ?? "AMD GPU"),
      vramTotalBytes: total,
      vramFreeBytes: free,
    };
  }
  return undefined;
}

export function parseWinGpu(out: string): { gpuVendor: HardwareProfile["gpuVendor"]; gpuName: string; vramTotalBytes: number; vramFreeBytes: number } | undefined {
  if (!out.trim()) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(out);
  } catch {
    return undefined;
  }
  const candidates = Array.isArray(data) ? data : [data];
  let best: { name: string; ram: number } | undefined;
  for (const entry of candidates) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.Name === "string" ? e.Name : "";
    const ram = typeof e.AdapterRAM === "number" ? e.AdapterRAM : 0;
    if (!best || ram > best.ram) best = { name, ram };
  }
  if (!best || best.ram <= 0) return undefined;
  const vendor = guessVendor(best.name);
  return {
    gpuVendor: vendor,
    gpuName: best.name,
    vramTotalBytes: best.ram,
    vramFreeBytes: best.ram,
  };
}

export function parseAppleGpuName(out: string): string | undefined {
  if (!out.trim()) return undefined;
  try {
    const data = JSON.parse(out);
    const arr = (data as Record<string, unknown>)["SPDisplaysDataType"];
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    const first = arr[0] as Record<string, unknown>;
    const name = first["sppci_model"] ?? first["_name"];
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
}

function guessVendor(name: string): HardwareProfile["gpuVendor"] {
  const lower = name.toLowerCase();
  if (lower.includes("nvidia") || lower.includes("geforce") || lower.includes("rtx") || lower.includes("quadro")) return "nvidia";
  if (lower.includes("amd") || lower.includes("radeon")) return "amd";
  if (lower.includes("intel") || lower.includes("arc")) return "intel";
  return "unknown";
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number.parseFloat(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("timeout"));
    }, PROBE_TIMEOUT_MS);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`exit ${code}`));
    });
  });
}

export function describeBackend(backend: GpuBackend): string {
  switch (backend) {
    case "cuda": return "NVIDIA CUDA";
    case "rocm": return "AMD ROCm";
    case "metal": return "Apple Metal";
    case "vulkan": return "Vulkan";
    case "cpu": return "CPU only";
  }
}
