export type FimDialect = "qwen" | "codegemma" | "codellama";

export interface FimSupport {
  supported: true;
  dialect: FimDialect;
  stop: string[];
  template: (prefix: string, suffix: string) => string;
}

export interface FimUnsupported {
  supported: false;
  reason: string;
}

export type FimDetectionResult = FimSupport | FimUnsupported;

export interface FimDetectOptions {
  root: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 800;

const QWEN_STOP = [
  "<|fim_pad|>",
  "<|endoftext|>",
  "<|im_end|>",
  "<|file_sep|>",
  "<|fim_prefix|>",
  "<|fim_suffix|>",
  "<|fim_middle|>",
];

const CODEGEMMA_STOP = [
  "<|file_separator|>",
  "<|fim_prefix|>",
  "<|fim_suffix|>",
  "<|fim_middle|>",
  "<eos>",
  "<end_of_turn>",
];

const CODELLAMA_STOP = ["<EOT>", "<PRE>", "<SUF>", "<MID>"];

export function buildQwenPrompt(prefix: string, suffix: string): string {
  return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
}

// Model families that ship infill tokens, so the main chat model can also drive
// autocomplete. The whole Qwen line (Qwen3.6 instruct included, not just the
// Coder variants) carries <|fim_prefix|> etc.
const FIM_CAPABLE_HINTS = [
  "qwen",
  "codeqwen",
  "codellama",
  "code-llama",
  "codegemma",
  "code-gemma",
  "deepseek-coder",
  "deepseek_coder",
  "codestral",
  "starcoder",
  "stable-code",
  "granite-code",
];

// Families that chat but expose no infill tokens. A plain Gemma instruct model
// cannot do FIM even though it answers chat fine, so it must never be reused as
// the autocomplete model.
const FIM_INCAPABLE_HINTS = ["gemma"];

// Decide FIM capability from a model id alone, before any network probe.
// Returns true/false for known families, undefined when the name is unknown so
// the caller falls back to the /tokenize probe. Capable hints win over
// incapable ones so "codegemma" resolves to true despite containing "gemma".
export function fimCapableByModelName(model: string | undefined): boolean | undefined {
  const name = model?.trim().toLowerCase();
  if (!name) return undefined;
  if (FIM_CAPABLE_HINTS.some((hint) => name.includes(hint))) return true;
  if (FIM_INCAPABLE_HINTS.some((hint) => name.includes(hint))) return false;
  return undefined;
}

export function fimSupportByModelName(model: string | undefined): FimSupport | undefined {
  const name = model?.trim().toLowerCase();
  if (!name) return undefined;
  if (name.includes("qwen") || name.includes("codeqwen")) {
    return qwenSupport();
  }
  if (name.includes("codegemma") || name.includes("code-gemma")) {
    return codeGemmaSupport();
  }
  if (name.includes("codellama") || name.includes("code-llama")) {
    return codeLlamaSupport();
  }
  return undefined;
}

function buildCodeLlamaPrompt(prefix: string, suffix: string): string {
  return `<PRE> ${prefix} <SUF>${suffix} <MID>`;
}

export async function detectFim(options: FimDetectOptions): Promise<FimDetectionResult> {
  const knownSupport = fimSupportByModelName(options.model);
  if (knownSupport) return knownSupport;

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const root = trimSlash(options.root);

  const tokenize = async (content: string): Promise<number | undefined> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onParentAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onParentAbort);
    try {
      const response = await fetchImpl(`${root}/tokenize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, add_special: false, ...(options.model ? { model: options.model } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      const data = await response.json() as { tokens?: unknown };
      return Array.isArray(data.tokens) ? data.tokens.length : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onParentAbort);
    }
  };

  const fimPrefix = await tokenize("<|fim_prefix|>");
  if (fimPrefix === undefined) {
    return { supported: false, reason: "Could not reach /tokenize on the autocomplete endpoint." };
  }

  if (fimPrefix === 1) {
    const fileSeparator = await tokenize("<|file_separator|>");
    if (fileSeparator === 1) {
      return codeGemmaSupport();
    }
    return qwenSupport();
  }

  const pre = await tokenize("<PRE>");
  if (pre === 1) {
    return codeLlamaSupport();
  }

  return {
    supported: false,
    reason: "The loaded model does not expose a supported FIM token dialect.",
  };
}

function qwenSupport(): FimSupport {
  return { supported: true, dialect: "qwen", stop: QWEN_STOP, template: buildQwenPrompt };
}

function codeGemmaSupport(): FimSupport {
  return { supported: true, dialect: "codegemma", stop: CODEGEMMA_STOP, template: buildQwenPrompt };
}

function codeLlamaSupport(): FimSupport {
  return { supported: true, dialect: "codellama", stop: CODELLAMA_STOP, template: buildCodeLlamaPrompt };
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function toRootBase(endpoint: string): string {
  return trimSlash(endpoint).replace(/\/v1$/, "");
}
