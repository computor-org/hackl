import { CATALOG, ModelEntry } from "./catalog";

export type GpuBackend = "cuda" | "rocm" | "metal" | "vulkan" | "cpu";
export type FitLevel = "full" | "partial" | "no";

export interface HardwareProfile {
  platform: "linux" | "darwin" | "win32";
  arch: "x64" | "arm64";
  totalRamBytes: number;
  freeRamBytes: number;
  physicalCores: number;
  gpuVendor?: "nvidia" | "amd" | "intel" | "apple" | "unknown";
  gpuName?: string;
  vramTotalBytes?: number;
  vramFreeBytes?: number;
  backend: GpuBackend;
  unifiedMemory: boolean;
}

export interface ModelFit {
  modelId: string;
  fits: FitLevel;
  nGpuLayers: number;
  ctxSize: number;
  cpuMoe?: number;
  threads: number;
  flashAttn: "auto" | "off";
  cacheTypeK: "q8_0";
  cacheTypeV: "q8_0";
  weightBytes: number;
  kvBytes: number;
  scratchBytes: number;
  totalBytes: number;
  vramBudgetBytes: number;
  notes: string[];
}

export interface Recommendation {
  hardware: HardwareProfile;
  fits: ModelFit[];
  recommendedId?: string;
}

const SCRATCH = 1.0 * 1024 ** 3;
const PARTIAL_THRESHOLD = 0.7;

export function vramBudget(hw: HardwareProfile): number {
  if (hw.unifiedMemory) {
    // Apple Silicon: use Metal wired limit if known, else 67% of total RAM.
    return hw.vramTotalBytes ?? Math.floor(hw.totalRamBytes * 0.67);
  }
  if (hw.backend === "cpu" || !hw.vramTotalBytes) return 0;
  return hw.vramFreeBytes ?? hw.vramTotalBytes;
}

export function kvBytes(model: ModelEntry, ctx: number): number {
  return model.kvBytesPerTokenQ8 * ctx;
}

export function fitModel(model: ModelEntry, hw: HardwareProfile, ctxOverride?: number): ModelFit {
  const ctx = ctxOverride ?? model.recommendedCtx;
  const vram = vramBudget(hw);
  const notes: string[] = [];
  const perLayer = model.weightBytes / model.nLayers;
  let kv = kvBytes(model, ctx);
  let used = model.weightBytes + kv + SCRATCH;
  let chosenCtx = ctx;

  // If CPU-only path
  if (hw.backend === "cpu" || vram <= 0) {
    const ramBudget = hw.freeRamBytes;
    const ramFits = model.weightBytes + kv + SCRATCH <= ramBudget;
    return {
      modelId: model.id,
      fits: ramFits ? "full" : "no",
      nGpuLayers: 0,
      ctxSize: chosenCtx,
      threads: Math.max(2, hw.physicalCores - 2),
      flashAttn: "off",
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      weightBytes: model.weightBytes,
      kvBytes: kv,
      scratchBytes: SCRATCH,
      totalBytes: model.weightBytes + kv + SCRATCH,
      vramBudgetBytes: 0,
      notes: ramFits ? ["CPU-only execution; expect slow tokens/sec."] : ["Model + KV exceed available RAM."],
    };
  }

  // GPU path: shrink context to find a full fit before falling back to partial.
  while (chosenCtx > model.minCtx && model.weightBytes + kvBytes(model, chosenCtx) + SCRATCH > vram) {
    chosenCtx = Math.max(model.minCtx, Math.floor(chosenCtx / 2));
  }
  kv = kvBytes(model, chosenCtx);
  used = model.weightBytes + kv + SCRATCH;

  if (used <= vram) {
    return {
      modelId: model.id,
      fits: "full",
      nGpuLayers: 99,
      ctxSize: chosenCtx,
      threads: Math.max(2, hw.physicalCores - 2),
      flashAttn: flashAttnFor(hw.backend),
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      weightBytes: model.weightBytes,
      kvBytes: kv,
      scratchBytes: SCRATCH,
      totalBytes: used,
      vramBudgetBytes: vram,
      notes: ["Full GPU offload."],
    };
  }

  // Partial fit
  const remainingForLayers = vram - kv - SCRATCH;
  const layersFit = remainingForLayers > 0 ? Math.floor(remainingForLayers / perLayer) : 0;
  const layerFraction = layersFit / model.nLayers;

  if (model.isMoE) {
    // CPU-MoE strategy: keep attention on GPU, push expert FFN of leading layers to CPU.
    const cpuMoe = Math.max(0, model.nLayers - Math.max(1, layersFit));
    const ramNeed = model.weightBytes * (cpuMoe / model.nLayers);
    const ramOk = ramNeed + SCRATCH <= hw.freeRamBytes;
    return {
      modelId: model.id,
      fits: ramOk && layersFit >= 1 ? "partial" : "no",
      nGpuLayers: 99,
      ctxSize: chosenCtx,
      cpuMoe,
      threads: Math.max(2, hw.physicalCores - 2),
      flashAttn: flashAttnFor(hw.backend),
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      weightBytes: model.weightBytes,
      kvBytes: kv,
      scratchBytes: SCRATCH,
      totalBytes: used,
      vramBudgetBytes: vram,
      notes: [
        `MoE split: ${cpuMoe}/${model.nLayers} expert FFN blocks on CPU.`,
        ramOk ? "RAM budget sufficient." : "Insufficient free RAM for expert offload.",
      ],
    };
  }

  // Dense partial fit
  const ngl = Math.max(0, Math.min(model.nLayers - 1, layersFit));
  const ramNeed = (model.weightBytes * (model.nLayers - ngl)) / model.nLayers;
  const ramOk = ramNeed + SCRATCH <= hw.freeRamBytes;
  const fits: FitLevel = ramOk ? (layerFraction >= PARTIAL_THRESHOLD ? "partial" : "no") : "no";
  return {
    modelId: model.id,
    fits,
    nGpuLayers: ngl,
    ctxSize: chosenCtx,
    threads: Math.max(2, hw.physicalCores - 2),
    flashAttn: flashAttnFor(hw.backend),
    cacheTypeK: "q8_0",
    cacheTypeV: "q8_0",
    weightBytes: model.weightBytes,
    kvBytes: kv,
    scratchBytes: SCRATCH,
    totalBytes: used,
    vramBudgetBytes: vram,
    notes: [
      `Partial offload: ${ngl}/${model.nLayers} layers on GPU.`,
      ramOk ? "RAM budget sufficient." : "Insufficient free RAM for remaining layers.",
    ],
  };
}

function flashAttnFor(backend: GpuBackend): "auto" | "off" {
  if (backend === "cuda" || backend === "metal" || backend === "vulkan") return "auto";
  return "off";
}

export function recommend(hw: HardwareProfile, models: ModelEntry[] = CATALOG): Recommendation {
  const fits = models.map((m) => fitModel(m, hw));
  // Prefer largest params with full fit; otherwise largest with partial fit.
  const sorted = [...fits].sort((a, b) => modelParams(b.modelId) - modelParams(a.modelId));
  const bestFull = sorted.find((f) => f.fits === "full");
  const bestPartial = sorted.find((f) => f.fits === "partial");
  const recommendedId = bestFull?.modelId ?? bestPartial?.modelId;
  return { hardware: hw, fits, recommendedId };
}

function modelParams(id: string): number {
  const entry = CATALOG.find((m) => m.id === id);
  return entry?.paramsB ?? 0;
}

export function llamaServerArgs(model: ModelEntry, fit: ModelFit, modelPath: string, port: number): string[] {
  const args = [
    "-m", modelPath,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--alias", model.alias,
    "-c", String(fit.ctxSize),
    "-ngl", String(fit.nGpuLayers),
    "--cache-type-k", fit.cacheTypeK,
    "--cache-type-v", fit.cacheTypeV,
    "--jinja",
    "--threads", String(fit.threads),
    "--no-context-shift",
  ];
  if (fit.flashAttn === "auto") {
    args.push("-fa", "on");
  }
  if (fit.cpuMoe && fit.cpuMoe > 0) {
    args.push("--n-cpu-moe", String(fit.cpuMoe));
  }
  return args;
}
