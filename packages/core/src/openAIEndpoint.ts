export function normalizeOpenAIEndpoint(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;

  try {
    const url = new URL(trimmed);
    url.hash = "";
    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = "/v1";
    } else {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

export function validateModelEndpoint(endpoint: string, hasKey: boolean, codespaces = false): void {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("Model endpoint must be an HTTP(S) URL without credentials or query parameters");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((codespaces && (local || !hasKey || url.protocol !== "https:"))
    || (hasKey && !local && url.protocol !== "https:")) {
    throw new Error("Use HTTPS for provider keys; Codespaces requires an external provider and your own key");
  }
}
