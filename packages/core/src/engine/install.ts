import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";
import { llamacppHome, managedBinRoot } from "./paths";
import { commandExists } from "./probe";
import { LLAMACPP_RELEASE } from "./releases";

export type ServerSource = "env" | "home" | "managed" | "path";

export interface ResolvedServer {
  bin: string;
  libDir?: string;
  source: ServerSource;
}

const EXE = process.platform === "win32" ? "llama-server.exe" : "llama-server";

// Find an existing llama-server: explicit env, the slopcode-infra install dir, a
// previous managed install, then PATH. Returns undefined if none is available.
export async function resolveServerBin(env: NodeJS.ProcessEnv = process.env): Promise<ResolvedServer | undefined> {
  const explicit = env.LLAMACPP_SERVER_BIN?.trim();
  if (explicit && fs.existsSync(explicit)) return { bin: explicit, libDir: path.dirname(explicit), source: "env" };

  const homeBin = path.join(llamacppHome(env), EXE);
  if (fs.existsSync(homeBin)) return { bin: homeBin, libDir: path.dirname(homeBin), source: "home" };

  const managed = newestManagedBin(env);
  if (managed) return { bin: managed, libDir: path.dirname(managed), source: "managed" };

  if (await commandExists("llama-server")) return { bin: "llama-server", source: "path" };
  return undefined;
}

function newestManagedBin(env: NodeJS.ProcessEnv): string | undefined {
  const root = managedBinRoot(env);
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root).map((d) => path.join(root, d)).filter((d) => fs.statSync(d).isDirectory());
  } catch {
    return undefined;
  }
  for (const dir of dirs.sort().reverse()) {
    const bin = path.join(dir, EXE);
    if (fs.existsSync(bin)) return bin;
  }
  return undefined;
}

export function releaseFlavor(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin") return `macos-${arch}`;
  if (process.platform === "win32") return `win-vulkan-${arch}`;
  return `ubuntu-vulkan-${arch}`;
}

// Download, verify (sha256), and unpack the pinned llama.cpp prebuilt for this
// platform into the managed cache. Consent is the caller's responsibility.
export async function installManaged(env: NodeJS.ProcessEnv = process.env, log: (s: string) => void = () => {}): Promise<ResolvedServer> {
  const table = LLAMACPP_RELEASE;
  if (!table.tag) throw new Error("no pinned llama.cpp release configured");
  const flavor = releaseFlavor();
  const asset = table.assets[flavor];
  if (!asset) throw new Error(`no pinned llama.cpp asset for ${flavor}; install llama.cpp yourself and set LLAMACPP_HOME`);

  const destDir = path.join(managedBinRoot(env), table.tag);
  const existing = path.join(destDir, EXE);
  if (fs.existsSync(existing)) return { bin: existing, libDir: destDir, source: "managed" };

  fs.mkdirSync(destDir, { recursive: true });
  const tmp = path.join(destDir, ".download");
  fs.mkdirSync(tmp, { recursive: true });
  const pkg = path.join(tmp, asset.name);

  log(`downloading ${asset.url}`);
  await run("curl", ["-fSL", "-o", pkg, asset.url]);

  const digest = await sha256File(pkg);
  if (digest !== asset.sha256) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(`sha256 mismatch for ${asset.name}: expected ${asset.sha256}, got ${digest}`);
  }
  log("sha256 verified");

  if (asset.name.endsWith(".zip")) await run("unzip", ["-q", "-o", pkg, "-d", tmp]);
  else await run("tar", ["-xzf", pkg, "-C", tmp]);

  const binDir = findBinaryDir(tmp);
  if (!binDir) throw new Error("llama-server not found in the downloaded archive");
  for (const entry of fs.readdirSync(binDir)) {
    fs.cpSync(path.join(binDir, entry), path.join(destDir, entry), { recursive: true });
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  if (process.platform === "darwin") {
    // ggml-org release binaries are unsigned; clear quarantine + ad-hoc sign.
    await run("xattr", ["-c", path.join(destDir, EXE)]).catch(() => {});
    await run("codesign", ["--force", "--sign", "-", path.join(destDir, EXE)]).catch(() => {});
  }
  try { fs.chmodSync(path.join(destDir, EXE), 0o755); } catch { /* */ }
  log(`installed llama.cpp ${table.tag} at ${destDir}`);
  return { bin: path.join(destDir, EXE), libDir: destDir, source: "managed" };
}

function findBinaryDir(root: string): string | undefined {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) stack.push(path.join(dir, e.name));
      else if (e.name === EXE) return dir;
    }
  }
  return undefined;
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}
