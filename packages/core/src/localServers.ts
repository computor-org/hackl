import { normalizeOpenAIEndpoint } from "./openAIEndpoint";

export interface LocalServerCandidate {
  name: string;
  endpoint: string;
}

export interface ChatTargetSettings {
  endpoint?: string;
  endpointConfigured: boolean;
  preferredModel?: string;
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
export const DEFAULT_CHAT_MODEL = "local-model";
const PROBE_TIMEOUT_MS = 600;

export const LOCAL_SERVER_CANDIDATES: LocalServerCandidate[] = [
  { name: "llama.cpp", endpoint: "http://localhost:8080/v1" },
  { name: "llama.cpp (8081)", endpoint: "http://localhost:8081/v1" },
  { name: "LM Studio", endpoint: "http://localhost:1234/v1" },
];

export async function resolveChatTarget(settings: ChatTargetSettings): Promise<ChatTarget> {
  const configuredEndpoint = clean(settings.endpoint);
  const fetchImpl = settings.fetchImpl ?? fetch;
  const preferred = settings.preferredModel?.trim();

  if (settings.endpointConfigured && configuredEndpoint) {
    // An explicit chat model wins over auto-detection: a multi-model endpoint
    // (e.g. a routed gateway) lists several models and the first one is not necessarily
    // the right chat model. Skip the probe round-trip when we already know it.
    if (preferred) {
      return { endpoint: configuredEndpoint, model: preferred };
    }
    const probed = await probeServer(configuredEndpoint, fetchImpl);
    return {
      endpoint: configuredEndpoint,
      model: probed?.model ?? DEFAULT_CHAT_MODEL,
    };
  }

  const discovered = await discoverLocalServer(
    settings.candidates ?? LOCAL_SERVER_CANDIDATES,
    fetchImpl,
  );

  return {
    endpoint: discovered?.endpoint ?? DEFAULT_ENDPOINT,
    model: preferred || discovered?.model || DEFAULT_CHAT_MODEL,
  };
}

export async function listModelIds(
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const base = normalizeOpenAIEndpoint(endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${base}/models`, { signal: controller.signal });
    if (!response.ok) return [];
    return allModelIds(await response.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function allModelIds(payload: unknown): string[] {
  if (!isRecord(payload)) return [];
  const ids = new Set<string>();
  for (const [list, key] of [
    [payload.data, "id"],
    [payload.models, "model"],
    [payload.models, "name"],
  ] as Array<[unknown, "id" | "model" | "name"]>) {
    if (!Array.isArray(list)) continue;
    for (const model of list) {
      if (isRecord(model) && typeof model[key] === "string" && model[key].trim()) {
        ids.add(model[key]);
      }
    }
  }
  return [...ids];
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
  const base = normalizeOpenAIEndpoint(endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${base}/models`, { signal: controller.signal });
    if (!response.ok) {
      const model = firstAvailableModel(await response.text());
      return model ? { endpoint: base, model } : await probeHealth(base, fetchImpl);
    }
    return { endpoint: base, model: firstModelId(await response.json()) };
  } catch {
    return await probeHealth(base, fetchImpl);
  } finally {
    clearTimeout(timer);
  }
}

async function probeHealth(endpoint: string, fetchImpl: typeof fetch): Promise<ProbedServer | undefined> {
  const base = trimSlash(endpoint);
  const root = base.replace(/\/v1$/, "");
  for (const url of [`${root}/health`, `${base}/props`, `${root}/props`]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (response.ok) return { endpoint: base };
    } catch {
      // Try the next lightweight endpoint.
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
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
  return trimmed ? normalizeOpenAIEndpoint(trimmed) : undefined;
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
  preferredModel?: string,
): Promise<number | undefined> {
  const base = normalizeOpenAIEndpoint(endpoint);
  const root = base.replace(/\/v1$/, "");

  const llamaCtx = await tryFetchNumber(`${base}/props`, fetchImpl, contextFromProps)
    ?? await tryFetchNumber(`${root}/props`, fetchImpl, contextFromProps);
  if (llamaCtx) return llamaCtx;

  const lmStudioCtx = await tryFetchNumber(`${root}/api/v0/models`, fetchImpl, (data) => {
    if (!isRecord(data) || !Array.isArray(data.data)) return undefined;
    const models = preferredModel
      ? [...data.data].sort((a, b) => modelMatchScore(b, preferredModel) - modelMatchScore(a, preferredModel))
      : data.data;
    for (const model of models) {
      if (!isRecord(model)) continue;
      const loaded = positiveNumber(model.loaded_context_length);
      if (loaded) return loaded;
      const max = positiveNumber(model.max_context_length);
      if (max) return max;
    }
    return undefined;
  });
  if (lmStudioCtx) return lmStudioCtx;

  return await tryFetchNumber(`${base}/models`, fetchImpl, contextFromModels);
}

export async function resolveEffectiveContextTokens(
  endpoint: string,
  fallback: number,
  fetchImpl: typeof fetch = fetch,
  preferredModel?: string,
): Promise<number> {
  const detected = await detectMaxContextTokens(endpoint, fetchImpl, preferredModel).catch(() => undefined);
  return detected ?? fallback;
}

function modelMatchScore(value: unknown, preferredModel: string): number {
  if (!isRecord(value) || typeof value.id !== "string") return 0;
  return value.id === preferredModel ? 2 : 1;
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
