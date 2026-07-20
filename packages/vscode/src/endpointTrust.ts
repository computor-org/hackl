const TRUSTED_ENDPOINTS_KEY = "hackl.trustedEndpoints.v1";

export interface EndpointTrustStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export function normalizeTrustedEndpoint(endpoint: string): string | undefined {
  try {
    const url = new URL(endpoint.trim());
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export function isEndpointTrusted(store: EndpointTrustStore | undefined, endpoint: string): boolean {
  const normalized = normalizeTrustedEndpoint(endpoint);
  if (!store || !normalized) return false;
  return trustedEndpoints(store).includes(normalized);
}

export async function trustEndpoint(store: EndpointTrustStore | undefined, endpoint: string): Promise<void> {
  const normalized = normalizeTrustedEndpoint(endpoint);
  if (!store || !normalized) return;
  const trusted = new Set(trustedEndpoints(store));
  trusted.add(normalized);
  await store.update(TRUSTED_ENDPOINTS_KEY, [...trusted].sort());
}

export async function clearTrustedEndpoints(store: EndpointTrustStore | undefined): Promise<void> {
  if (!store) return;
  await store.update(TRUSTED_ENDPOINTS_KEY, []);
}

function trustedEndpoints(store: EndpointTrustStore): string[] {
  const value = store.get<unknown>(TRUSTED_ENDPOINTS_KEY);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
