import { probeAll, LOCAL_SERVER_CANDIDATES, type LocalServerCandidate } from "../localServers";
import { readEngineState, isAlive } from "./supervisor";

export interface DetectedServer {
  endpoint: string;
  model?: string;
  ctx?: number;
  managed: boolean;
}

// Ports Hackl will look at: the standard local candidates and the port of a
// server Hackl itself launched (from the state file).
export function engineCandidates(env: NodeJS.ProcessEnv = process.env): LocalServerCandidate[] {
  const list: LocalServerCandidate[] = [...LOCAL_SERVER_CANDIDATES];
  const state = readEngineState(env);
  if (state) {
    const host = state.host === "0.0.0.0" ? "127.0.0.1" : state.host;
    const ep = `http://${host}:${state.port}/v1`;
    if (!list.some((c) => c.endpoint === ep)) list.unshift({ name: "hackl-managed", endpoint: ep });
  }
  return list;
}

// First reachable local server, classified managed (hackl started it) vs external
// (someone else's — adopted read-only, never stopped by hackl).
export async function detectServer(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DetectedServer | undefined> {
  const results = await probeAll(engineCandidates(env), fetchImpl);
  const ok = results.find((r) => r.ok);
  if (!ok) return undefined;
  const state = readEngineState(env);
  const managed = Boolean(state && isAlive(state.pid) && ok.endpoint.includes(`:${state.port}`));
  return { endpoint: ok.endpoint, model: ok.model, ctx: ok.ctx, managed };
}
