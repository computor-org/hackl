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
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return undefined;
  }

  for (const model of payload.data) {
    if (isRecord(model) && typeof model.id === "string" && model.id.trim()) {
      return model.id;
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
