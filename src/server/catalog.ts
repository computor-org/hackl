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

// Sizes and sha256 hashes below come from real HuggingFace probes (May 2026):
//   GET resolve/main/<file> -> x-linked-etag header is the LFS sha256.
// Hackl verifies every catalog GGUF against `sha256` after download.
// Keep this list short on purpose. Five models is the cap.
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
    sha256: "68c9c6bfeecee13dd3b3c1de7f73b2d86e5feadc100f0f50e5e11fd2388ca66d",
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
    sha256: "9437f5bf0dd0c97800caaf902f41e6a6aa00223ab232f159eda41dcbbb492645",
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
    sha256: "519b9793ed6ce0ff530f1b7c96e848e08e49e7af4d57bb97f76215963a54146d",
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
    sha256: "453cf049ba87a29b9ed5739087b84b7fa0265a4f2b11eefa2c77683dec6a8020",
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
    sha256: "707a55a8a4397ecde44de0c499d3e68c1ad1d240d1da65826b4949d1043f4450",
    alias: "qwen3.6-35b-a3b",
  },
];

export function findModel(id: string): ModelEntry | undefined {
  return CATALOG.find((m) => m.id === id);
}
