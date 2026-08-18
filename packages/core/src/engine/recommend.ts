import type { SystemProbe } from "./probe";
import { MODEL_CATALOG, type ModelOption } from "./catalog";

export interface ModelRecommendation {
  primary: ModelOption;
  alternatives: ModelOption[];
  budgetGB: number;
  reason: string;
}

// Usable memory for model weights. Dedicated GPUs are bounded by VRAM; unified
// memory (Apple) and CPU decode leave headroom for the OS and KV cache.
export function memoryBudgetGB(probe: Pick<SystemProbe, "accelerator" | "totalRamGB" | "vramGB">): number {
  if (probe.accelerator === "cuda" || probe.accelerator === "rocm") {
    // A MoE with CPU-offload can exceed VRAM, so allow VRAM plus a slice of RAM.
    return Math.max(probe.vramGB ?? 0, Math.floor(probe.totalRamGB * 0.5));
  }
  // metal (unified) and cpu: most of RAM is usable, leave headroom for the OS + KV.
  return Math.max(2, probe.totalRamGB - 3);
}

export function recommendModel(probe: Pick<SystemProbe, "accelerator" | "totalRamGB" | "vramGB">): ModelRecommendation {
  const budget = memoryBudgetGB(probe);
  const sorted = [...MODEL_CATALOG].sort((a, b) => a.recommendedRamGB - b.recommendedRamGB);
  const fits = sorted.filter((m) => m.recommendedRamGB <= budget);
  let primary = fits.length ? fits[fits.length - 1] : sorted[0];

  // Preference rules (the user's calls):
  // 1. At ~16 GB prefer Qwen 9B over Gemma 12B (fits better, FIM, stronger code).
  if (budget >= 12 && budget <= 18 && primary.alias === "gemma-12b-q4") {
    primary = sorted.find((m) => m.alias === "qwen3.5-9b-q4") ?? primary;
  }
  const tight = primary.recommendedRamGB > budget;
  const accel = probe.accelerator + (probe.vramGB ? `, ${probe.vramGB} GiB VRAM` : "");
  const reason = tight
    ? `~${budget} GiB usable (${accel}) is below any catalog model's recommended size; expect slow or limited output.`
    : `~${budget} GiB usable for weights (${accel}).`;

  const alternatives = sorted.filter((m) => m.alias !== primary.alias && (m.recommendedRamGB <= budget || m.recommendedRamGB <= budget + 8)).slice(-3);
  return { primary, alternatives, budgetGB: budget, reason };
}
