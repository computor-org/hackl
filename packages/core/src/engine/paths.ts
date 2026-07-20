import * as os from "node:os";
import * as path from "node:path";

// XDG-correct locations for the managed engine, shared by every frontend so the
// CLI, the VS Code extension host, and the server all read/write the same files.
// LLAMACPP_* env vars are honored so an existing slopcode-infra install interops.

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return xdg ? path.join(xdg, "hackl") : path.join(os.homedir(), ".config", "hackl");
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(configDir(env), "config.json");
}

// Live runtime state (pid/port/log/activity). Prefer the runtime dir, then the
// state dir; never the config dir — this is ephemeral, not configuration.
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  const runtime = env.XDG_RUNTIME_DIR?.trim();
  if (runtime) return path.join(runtime, "hackl");
  const xdgState = env.XDG_STATE_HOME?.trim();
  return xdgState ? path.join(xdgState, "hackl") : path.join(os.homedir(), ".local", "state", "hackl");
}

// GGUF cache. Matches llama.cpp's own default so models pulled by either tool are
// shared; LLAMACPP_CACHE_ROOT overrides (slopcode-infra convention).
export function modelCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.LLAMACPP_CACHE_ROOT?.trim();
  if (explicit) return explicit;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Caches", "llama.cpp");
  return path.join(os.homedir(), ".cache", "llama.cpp");
}

// Where an existing llama.cpp install lives (slopcode-infra default).
export function llamacppHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.LLAMACPP_HOME?.trim() || path.join(os.homedir(), ".local", "llama.cpp");
}

// Where hackl unpacks a managed (downloaded) llama.cpp release.
export function managedBinRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(os.homedir(), ".cache", "hackl", "llama.cpp");
}

export const STATE_FILES = {
  pid: "engine.pid",
  port: "engine.port",
  state: "engine.json",
  log: "engine.log",
  activity: "engine.activity",
} as const;

export function stateFile(name: keyof typeof STATE_FILES, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateDir(env), STATE_FILES[name]);
}
