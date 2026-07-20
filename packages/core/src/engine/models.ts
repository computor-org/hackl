import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { ModelOption } from "./catalog";
import { modelCacheRoot } from "./paths";
import { commandExists } from "./probe";

// Mirror slopcode-infra/scripts/llamacpp_models.py cache layout so models pulled
// by either tool are shared: <cacheRoot>/<repo_with_underscores>/**.gguf, plus a
// flat <cacheRoot>/<repo>_*.gguf fallback.
export function modelCacheDir(model: ModelOption, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(modelCacheRoot(env), model.repo.replace(/\//g, "_"));
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function findGguf(model: ModelOption, include: string, env: NodeJS.ProcessEnv): string | undefined {
  const re = globToRegExp(include);
  const dir = modelCacheDir(model, env);
  const hit = walkGguf(dir).find((p) => re.test(path.basename(p)) || re.test(path.relative(dir, p)));
  if (hit) return hit;
  // flat fallback
  const root = modelCacheRoot(env);
  const prefix = model.repo.replace(/\//g, "_") + "_";
  try {
    for (const name of fs.readdirSync(root)) {
      if (name.startsWith(prefix) && name.endsWith(".gguf") && re.test(name.slice(prefix.length))) {
        return path.join(root, name);
      }
    }
  } catch { /* root may not exist */ }
  return undefined;
}

function walkGguf(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name.endsWith(".gguf")) out.push(full);
    }
  }
  return out.sort();
}

export function modelPath(model: ModelOption, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return findGguf(model, model.include, env);
}

export function mmprojPath(model: ModelOption, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return model.mmproj ? findGguf(model, model.mmproj, env) : undefined;
}

export function isPresent(model: ModelOption, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(modelPath(model, env));
}

export interface PullOptions {
  withMmproj?: boolean;
  env?: NodeJS.ProcessEnv;
  log?: (s: string) => void;
}

// Download a model into the shared cache via the Hugging Face CLI (matches the
// slopcode-infra prefetch path). Returns the resolved primary GGUF path.
export async function pullModel(model: ModelOption, opts: PullOptions = {}): Promise<string> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (() => {});
  if (modelPath(model, env)) return modelPath(model, env)!;

  const cli = (await commandExists("hf")) ? "hf" : (await commandExists("huggingface-cli")) ? "huggingface-cli" : undefined;
  if (!cli) throw new Error('Hugging Face CLI not found. Install with: uv tool install "huggingface_hub[cli]"');

  const dir = modelCacheDir(model, env);
  const args = ["download", model.repo, "--local-dir", dir, "--include", model.include];
  if (opts.withMmproj && model.mmproj) args.push("--include", model.mmproj);
  log(`downloading ${model.alias} from ${model.repo} (license: ${model.license})`);
  await runInherit(cli, args);

  const resolved = modelPath(model, env);
  if (!resolved) throw new Error(`download finished but no GGUF matched ${model.include} under ${dir}`);
  return resolved;
}

function runInherit(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}
