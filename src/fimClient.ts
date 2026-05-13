import { FimSupport } from "./fimDetect";

export interface FimRequest {
  prefix: string;
  suffix: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface FimClientOptions {
  root: string;
  model?: string;
  support: FimSupport;
  fetchImpl?: typeof fetch;
  maxPredictMs?: number;
}

const PREFIX_CHAR_CAP = 4000;
const SUFFIX_CHAR_CAP = 2000;
const PREFIX_LINE_CAP = 80;
const SUFFIX_LINE_CAP = 40;
const DEFAULT_MAX_PREDICT_MS = 800;

export function capPrefix(prefix: string): string {
  let trimmed = prefix.slice(-PREFIX_CHAR_CAP);
  const lines = trimmed.split("\n");
  if (lines.length > PREFIX_LINE_CAP) {
    trimmed = lines.slice(-PREFIX_LINE_CAP).join("\n");
  }
  return trimmed;
}

export function capSuffix(suffix: string): string {
  let trimmed = suffix.slice(0, SUFFIX_CHAR_CAP);
  const lines = trimmed.split("\n");
  if (lines.length > SUFFIX_LINE_CAP) {
    trimmed = lines.slice(0, SUFFIX_LINE_CAP).join("\n");
  }
  return trimmed;
}

export function trimAtStops(text: string, stops: string[]): string {
  let cut = text.length;
  for (const stop of stops) {
    if (!stop) continue;
    const idx = text.indexOf(stop);
    if (idx >= 0 && idx < cut) cut = idx;
  }
  return text.slice(0, cut);
}

export function dedupeAgainstSuffix(completion: string, suffix: string): string {
  if (!completion || !suffix) return completion;
  const leading = suffix.slice(0, 32);
  if (leading && completion.endsWith(leading)) {
    return completion.slice(0, completion.length - leading.length);
  }
  return completion;
}

export async function requestFim(
  options: FimClientOptions,
  request: FimRequest,
): Promise<string | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const root = options.root.replace(/\/+$/, "");
  const prefix = capPrefix(request.prefix);
  const suffix = capSuffix(request.suffix);
  const stops = [...options.support.stop, "\n\n\n"];

  const sharedBody = {
    n_predict: request.maxTokens,
    temperature: 0.15,
    top_p: 0.9,
    top_k: 40,
    cache_prompt: true,
    stop: stops,
    t_max_predict_ms: options.maxPredictMs ?? DEFAULT_MAX_PREDICT_MS,
    stream: false,
    ...(options.model ? { model: options.model } : {}),
  };

  const infillBody = {
    ...sharedBody,
    input_prefix: prefix,
    input_suffix: suffix,
    prompt: "",
  };

  const infillResult = await tryPost(fetchImpl, `${root}/infill`, infillBody, request.signal);
  if (infillResult !== undefined) return finalise(infillResult, suffix, stops);

  const completionBody = {
    ...sharedBody,
    prompt: options.support.template(prefix, suffix),
  };
  const completionResult = await tryPost(fetchImpl, `${root}/completion`, completionBody, request.signal);
  if (completionResult !== undefined) return finalise(completionResult, suffix, stops);

  return undefined;
}

async function tryPost(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { content?: unknown };
    return typeof data.content === "string" ? data.content : undefined;
  } catch {
    return undefined;
  }
}

function finalise(content: string, suffix: string, stops: string[]): string | undefined {
  let text = trimAtStops(content, stops);
  text = dedupeAgainstSuffix(text, suffix);
  return text.length > 0 ? text : undefined;
}
