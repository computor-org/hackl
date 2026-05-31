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

function buildCodeLlamaPrompt(prefix: string, suffix: string): string {
  return `<PRE> ${prefix} <SUF>${suffix} <MID>`;
}

export async function detectFim(options: FimDetectOptions): Promise<FimDetectionResult> {
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
        headers: headersForModel(options.model),
        body: JSON.stringify({ content, add_special: false }),
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
      return {
        supported: true,
        dialect: "codegemma",
        stop: CODEGEMMA_STOP,
        template: buildQwenPrompt,
      };
    }
    return {
      supported: true,
      dialect: "qwen",
      stop: QWEN_STOP,
      template: buildQwenPrompt,
    };
  }

  const pre = await tokenize("<PRE>");
  if (pre === 1) {
    return {
      supported: true,
      dialect: "codellama",
      stop: CODELLAMA_STOP,
      template: buildCodeLlamaPrompt,
    };
  }

  return {
    supported: false,
    reason: "The loaded model does not expose a supported FIM token dialect.",
  };
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function headersForModel(model: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (model) {
    headers["x-model"] = model;
  }
  return headers;
}

export function toRootBase(endpoint: string): string {
  return trimSlash(endpoint).replace(/\/v1$/, "");
}
