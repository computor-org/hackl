export type Quant = "q4_k_m" | "ud_q4_k_xl" | "ud_q4_k_m";

export interface ModelEntry {
  id: string;
  displayName: string;
  paramsB: number;
  activeParamsB?: number;
  isMoE: boolean;
  nLayers: number;
  kvBytesPerTokenQ8: number;
  weightBytes: number;
  nativeCtx: number;
  recommendedCtx: number;
  minCtx: number;
  quant: Quant;
  hfRepo: string;
  ggufFile: string;
  sha256?: string;
  alias: string;
}

// Sizes below come from real HuggingFace content-length probes (May 2026).
export const CATALOG: ModelEntry[] = [
  {
    id: "qwen3.5-4b",
    displayName: "Qwen3.5 4B (Instruct)",
    paramsB: 4,
    isMoE: false,
    nLayers: 36,
    kvBytesPerTokenQ8: 2 * 36 * 8 * 128,
    weightBytes: 2_871_743_520,
    nativeCtx: 131072,
    recommendedCtx: 32768,
    minCtx: 8192,
    quant: "q4_k_m",
    hfRepo: "bartowski/Qwen_Qwen3.5-4B-GGUF",
    ggufFile: "Qwen_Qwen3.5-4B-Q4_K_M.gguf",
    alias: "qwen3.5-4b",
  },
  {
    id: "qwen3.5-9b",
    displayName: "Qwen3.5 9B (Instruct)",
    paramsB: 9,
    isMoE: false,
    nLayers: 36,
    kvBytesPerTokenQ8: 2 * 36 * 8 * 128,
    weightBytes: 5_889_811_552,
    nativeCtx: 131072,
    recommendedCtx: 65536,
    minCtx: 8192,
    quant: "q4_k_m",
    hfRepo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
    ggufFile: "Qwen_Qwen3.5-9B-Q4_K_M.gguf",
    alias: "qwen3.5-9b",
  },
  {
    id: "gemma-4-e4b",
    displayName: "Gemma 4 E4B (Instruct)",
    paramsB: 4,
    isMoE: false,
    nLayers: 26,
    kvBytesPerTokenQ8: 2 * 26 * 4 * 256,
    weightBytes: 4_977_169_568,
    nativeCtx: 131072,
    recommendedCtx: 32768,
    minCtx: 8192,
    quant: "q4_k_m",
    hfRepo: "unsloth/gemma-4-E4B-it-GGUF",
    ggufFile: "gemma-4-E4B-it-Q4_K_M.gguf",
    alias: "gemma-4-e4b",
  },
  {
    id: "gemma-4-26b-a4b",
    displayName: "Gemma 4 26B-A4B (Instruct, MoE)",
    paramsB: 26,
    activeParamsB: 4,
    isMoE: true,
    nLayers: 32,
    kvBytesPerTokenQ8: 2 * 32 * 8 * 256,
    weightBytes: 17_010_978_592,
    nativeCtx: 262144,
    recommendedCtx: 65536,
    minCtx: 16384,
    quant: "ud_q4_k_xl",
    hfRepo: "unsloth/gemma-4-26B-A4B-it-GGUF",
    ggufFile: "gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf",
    alias: "gemma-4-26b-a4b",
  },
  {
    id: "qwen3.6-35b-a3b",
    displayName: "Qwen3.6 35B-A3B (Coder, MoE)",
    paramsB: 35,
    activeParamsB: 3,
    isMoE: true,
    nLayers: 48,
    kvBytesPerTokenQ8: 2 * 48 * 8 * 128,
    weightBytes: 22_360_456_160,
    nativeCtx: 262144,
    recommendedCtx: 131072,
    minCtx: 16384,
    quant: "ud_q4_k_xl",
    hfRepo: "unsloth/Qwen3.6-35B-A3B-GGUF",
    ggufFile: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf",
    alias: "qwen3.6-35b-a3b",
  },
];

export function findModel(id: string): ModelEntry | undefined {
  return CATALOG.find((m) => m.id === id);
}
