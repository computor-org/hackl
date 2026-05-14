export interface LocalServerCandidate {
  name: string;
  endpoint: string;
}

export interface ChatTargetSettings {
  endpoint?: string;
  endpointConfigured: boolean;
  fetchImpl?: typeof fetch;
  candidates?: LocalServerCandidate[];
}

export interface ChatTarget {
  endpoint: string;
  model: string;
}

interface ProbedServer {
  endpoint: string;
  model?: string;
}

const DEFAULT_ENDPOINT = "http://localhost:8080/v1";
const DEFAULT_MODEL = "local-model";
const PROBE_TIMEOUT_MS = 600;

export const LOCAL_SERVER_CANDIDATES: LocalServerCandidate[] = [
  { name: "llama.cpp", endpoint: "http://localhost:8080/v1" },
  { name: "LM Studio", endpoint: "http://localhost:1234/v1" },
];

export async function resolveChatTarget(settings: ChatTargetSettings): Promise<ChatTarget> {
  const configuredEndpoint = clean(settings.endpoint);
  const fetchImpl = settings.fetchImpl ?? fetch;

  if (settings.endpointConfigured && configuredEndpoint) {
    const probed = await probeServer(configuredEndpoint, fetchImpl);
    return {
      endpoint: configuredEndpoint,
      model: probed?.model ?? DEFAULT_MODEL,
    };
  }

  const discovered = await discoverLocalServer(
    settings.candidates ?? LOCAL_SERVER_CANDIDATES,
    fetchImpl,
  );

  return {
    endpoint: discovered?.endpoint ?? DEFAULT_ENDPOINT,
    model: discovered?.model ?? DEFAULT_MODEL,
  };
}

export function requiresNonLocalEndpointApproval(endpoint: string | undefined): boolean {
  const configuredEndpoint = clean(endpoint);
  if (!configuredEndpoint) {
    return false;
  }

  try {
    const { hostname } = new URL(configuredEndpoint);
    return !isLoopbackHostname(hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost"
    || host === "::1"
    || host.startsWith("127.");
}

async function discoverLocalServer(
  candidates: LocalServerCandidate[],
  fetchImpl: typeof fetch,
): Promise<ProbedServer | undefined> {
  for (const candidate of candidates) {
    const probed = await probeServer(candidate.endpoint, fetchImpl);
    if (probed) {
      return probed;
    }
  }
  return undefined;
}

async function probeServer(endpoint: string, fetchImpl: typeof fetch): Promise<ProbedServer | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${trimSlash(endpoint)}/models`, { signal: controller.signal });
    if (!response.ok) {
      const model = firstAvailableModel(await response.text());
      return model ? { endpoint: trimSlash(endpoint), model } : undefined;
    }
    return { endpoint: trimSlash(endpoint), model: firstModelId(await response.json()) };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function firstAvailableModel(text: string): string | undefined {
  const match = text.match(/available:\s*([^)]+)/i);
  const models = match?.[1]?.split(",") ?? [];

  for (const model of models) {
    const cleaned = model.trim().replace(/[).]+$/, "");
    if (cleaned) {
      return cleaned;
    }
  }
  return undefined;
}

function firstModelId(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const openAi = firstModelIdFromList(payload.data, "id");
  if (openAi) return openAi;
  return firstModelIdFromList(payload.models, "model") ?? firstModelIdFromList(payload.models, "name");
}

function firstModelIdFromList(value: unknown, key: "id" | "model" | "name"): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const model of value) {
    if (isRecord(model) && typeof model[key] === "string" && model[key].trim()) {
      return model[key];
    }
  }
  return undefined;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimSlash(trimmed) : undefined;
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface ProbeResult {
  candidate: string;
  endpoint: string;
  ok: boolean;
  model?: string;
  ctx?: number;
  latencyMs?: number;
  error?: string;
}

export async function probeAll(
  candidates: LocalServerCandidate[],
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult[]> {
  return Promise.all(candidates.map(async (c) => {
    const started = Date.now();
    const probed = await probeServer(c.endpoint, fetchImpl);
    if (!probed) {
      return { candidate: c.name, endpoint: c.endpoint, ok: false, latencyMs: Date.now() - started };
    }
    const ctx = await detectMaxContextTokens(probed.endpoint, fetchImpl).catch(() => undefined);
    return {
      candidate: c.name,
      endpoint: probed.endpoint,
      ok: true,
      model: probed.model,
      ctx,
      latencyMs: Date.now() - started,
    };
  }));
}

export async function detectMaxContextTokens(
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | undefined> {
  const base = trimSlash(endpoint);
  const root = base.replace(/\/v1$/, "");

  const llamaCtx = await tryFetchNumber(`${base}/props`, fetchImpl, contextFromProps)
    ?? await tryFetchNumber(`${root}/props`, fetchImpl, contextFromProps);
  if (llamaCtx) return llamaCtx;

  const modelCtx = await tryFetchNumber(`${base}/models`, fetchImpl, contextFromModels);
  if (modelCtx) return modelCtx;

  const lmStudioCtx = await tryFetchNumber(`${root}/api/v0/models`, fetchImpl, (data) => {
    if (!isRecord(data) || !Array.isArray(data.data)) return undefined;
    for (const model of data.data) {
      if (!isRecord(model)) continue;
      const loaded = positiveNumber(model.loaded_context_length);
      if (loaded) return loaded;
      const max = positiveNumber(model.max_context_length);
      if (max) return max;
    }
    return undefined;
  });
  return lmStudioCtx;
}

function contextFromProps(data: unknown): number | undefined {
  if (!isRecord(data)) return undefined;
  const direct = positiveNumber(data.n_ctx);
  if (direct) return direct;
  const settings = isRecord(data.default_generation_settings) ? data.default_generation_settings : undefined;
  if (!settings) return undefined;
  const settingsDirect = positiveNumber(settings.n_ctx);
  if (settingsDirect) return settingsDirect;
  const params = isRecord(settings.params) ? settings.params : undefined;
  return params ? positiveNumber(params.n_ctx) : undefined;
}

function contextFromModels(data: unknown): number | undefined {
  if (!isRecord(data)) return undefined;
  const lists = [data.data, data.models];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const model of list) {
      if (!isRecord(model)) continue;
      const direct = positiveNumber(model.n_ctx) ?? positiveNumber(model.n_ctx_train);
      if (direct) return direct;
      const meta = isRecord(model.meta) ? model.meta : undefined;
      const metaCtx = meta
        ? positiveNumber(meta.n_ctx) ?? positiveNumber(meta.n_ctx_train) ?? positiveNumber(meta.context_length)
        : undefined;
      if (metaCtx) return metaCtx;
    }
  }
  return undefined;
}

async function tryFetchNumber(
  url: string,
  fetchImpl: typeof fetch,
  extract: (data: unknown) => number | undefined,
): Promise<number | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return undefined;
    const data = await response.json();
    return extract(data);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
