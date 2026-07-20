import type { IncomingMessage } from "node:http";

// Loopback only. Binding to 127.0.0.1 plus a Host-header allowlist defeats
// DNS-rebinding against the local server; the Origin check blocks a malicious
// page in the user's normal browser from driving the localhost server.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function hostname(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    return end > 0 ? v.slice(0, end + 1) : v;
  }
  return v.split(":")[0];
}

export function isAllowedHost(req: IncomingMessage): boolean {
  const host = hostname(req.headers.host);
  return host !== undefined && LOOPBACK.has(host);
}

export function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (curl, ws lib, desktop shell)
  try {
    return LOOPBACK.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

// Token sources, in order: an HttpOnly cookie (the browser path, set by the
// bootstrap redirect so the token never persists in the page URL), the URL
// query (non-browser clients and the one-time bootstrap), and a Bearer header.
export function extractToken(req: IncomingMessage): string | undefined {
  const cookie = readCookieToken(req);
  if (cookie) return cookie;
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    const q = url.searchParams.get("token");
    if (q) return q;
  } catch {
    // fall through
  }
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  return undefined;
}

export const TOKEN_COOKIE = "hackl_token";

function readCookieToken(req: IncomingMessage): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const match = new RegExp("(?:^|; )" + TOKEN_COOKIE + "=([^;]+)").exec(header);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
