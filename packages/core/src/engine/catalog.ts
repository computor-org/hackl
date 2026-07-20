// Curated public model catalog for the managed engine. A small, hardware-spanning
// subset of the slopcode-infra blessed set (the user owns that infra); users can
// always pull their own GGUF by HF repo or path. Sizes are approximate Q4 weights.

export type ModelFamily = "qwen" | "qwen-coder" | "gemma" | "gpt-oss";
export type ModelKind = "coder" | "chat" | "moe";

export interface ModelOption {
  alias: string;
  repo: string;          // Hugging Face GGUF repo (llama.cpp -hf target)
  include: string;       // GGUF filename/quant glob (huggingface-cli --include)
  quant: string;
  approxSizeGB: number;
  minRamGB: number;
  recommendedRamGB: number;
  family: ModelFamily;
  kind: ModelKind;
  fim: boolean;          // ships infill tokens (usable for autocomplete)
  mmproj?: string;       // mmproj include glob when the model ships a vision projector
  mtp?: boolean;         // ships a multi-token-prediction head (spec decoding)
  license: string;
  note?: string;
}

// Ordered small -> large; recommend() picks the largest that fits the budget.
export const MODEL_CATALOG: ModelOption[] = [
  { alias: "qwen2.5-coder-1.5b-q4", repo: "Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF", include: "*q4_k_m*.gguf", quant: "Q4_K_M", approxSizeGB: 1.1, minRamGB: 3, recommendedRamGB: 4, family: "qwen-coder", kind: "coder", fim: true, license: "Apache-2.0" },
  { alias: "qwen2.5-coder-3b-q4", repo: "Qwen/Qwen2.5-Coder-3B-Instruct-GGUF", include: "*q4_k_m*.gguf", quant: "Q4_K_M", approxSizeGB: 2.2, minRamGB: 4, recommendedRamGB: 5, family: "qwen-coder", kind: "coder", fim: true, license: "Apache-2.0" },
  { alias: "qwen3.5-4b-q4", repo: "bartowski/Qwen_Qwen3.5-4B-GGUF", include: "*Q4_K_M*.gguf", quant: "Q4_K_M", approxSizeGB: 2.8, minRamGB: 5, recommendedRamGB: 6, family: "qwen", kind: "chat", fim: true, license: "Apache-2.0" },
  { alias: "qwen2.5-coder-7b-q4", repo: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF", include: "*q4_k_m*.gguf", quant: "Q4_K_M", approxSizeGB: 4.7, minRamGB: 7, recommendedRamGB: 8, family: "qwen-coder", kind: "coder", fim: true, license: "Apache-2.0" },
  { alias: "qwen3.5-9b-q4", repo: "bartowski/Qwen_Qwen3.5-9B-GGUF", include: "*Q4_K_M*.gguf", quant: "Q4_K_M", approxSizeGB: 6, minRamGB: 8, recommendedRamGB: 10, family: "qwen", kind: "chat", fim: true, license: "Apache-2.0", note: "Preferred over Gemma 12B at ~16 GB: fits better, ships FIM tokens, stronger at code." },
  { alias: "gemma-12b-q4", repo: "unsloth/gemma-4-12B-it-GGUF", include: "*Q4_K_M*.gguf", quant: "Q4_K_M", approxSizeGB: 7.3, minRamGB: 10, recommendedRamGB: 12, family: "gemma", kind: "chat", fim: false, license: "Gemma", note: "Chat-only (no FIM). Repo verified at install time." },
  { alias: "gpt-oss-20b", repo: "ggml-org/gpt-oss-20b-GGUF", include: "*mxfp4*.gguf", quant: "MXFP4", approxSizeGB: 11.3, minRamGB: 13, recommendedRamGB: 16, family: "gpt-oss", kind: "moe", fim: false, license: "Apache-2.0", note: "MoE ~3.6B active, GPU-friendly. No FIM, no MTP." },
  { alias: "qwen3.6-27b-q4", repo: "bartowski/Qwen_Qwen3.6-27B-GGUF", include: "*Q4_K_M*.gguf", quant: "Q4_K_M", approxSizeGB: 16, minRamGB: 20, recommendedRamGB: 22, family: "qwen", kind: "chat", fim: true, mmproj: "mmproj-*f16.gguf", license: "Apache-2.0", note: "Dense 27B: slower to decode than the 35B-A3B MoE despite fewer total params." },
  { alias: "qwen3.6-35b-a3b-q4", repo: "unsloth/Qwen3.6-35B-A3B-GGUF", include: "*UD-Q4_K_XL*.gguf", quant: "UD-Q4_K_XL", approxSizeGB: 23, minRamGB: 22, recommendedRamGB: 26, family: "qwen", kind: "moe", fim: true, mmproj: "mmproj-BF16.gguf", license: "Apache-2.0", note: "MoE ~3B active: faster decode than the dense 27B. CPU-MoE offload makes it fit modest VRAM." },
  { alias: "qwen3.6-35b-a3b-mtp-q4", repo: "unsloth/Qwen3.6-35B-A3B-MTP-GGUF", include: "*UD-Q4_K_XL*.gguf", quant: "UD-Q4_K_XL", approxSizeGB: 24, minRamGB: 24, recommendedRamGB: 28, family: "qwen", kind: "moe", fim: true, mmproj: "mmproj-BF16.gguf", mtp: true, license: "Apache-2.0", note: "35B-A3B with the MTP head: speculative decode for 1.4-2.2x on hosts with headroom." },
];

export const CATALOG_BY_ALIAS: Record<string, ModelOption> = Object.fromEntries(
  MODEL_CATALOG.map((m) => [m.alias, m]),
);

export function findModel(alias: string): ModelOption | undefined {
  return CATALOG_BY_ALIAS[alias];
}
