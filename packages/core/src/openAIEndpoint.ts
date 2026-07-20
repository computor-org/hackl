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
