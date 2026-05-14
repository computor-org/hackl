import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";
import { HardwareProfile } from "./recommend";

const RELEASES_API = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string; // GitHub API: "sha256:<64-hex>"
}

export interface ReleaseInfo {
  tag_name: string;
  assets: ReleaseAsset[];
}

export interface ProgressSink {
  message: (text: string) => void;
  fraction?: (value: number) => void;
  isCancelled?: () => boolean;
}

class CancellationError extends Error {
  constructor() { super("Cancelled"); this.name = "CancellationError"; }
}

export function isCancellation(err: unknown): boolean {
  return err instanceof Error && err.name === "CancellationError";
}

export async function fetchLatestRelease(fetchImpl: typeof fetch = fetch): Promise<ReleaseInfo> {
  const res = await fetchImpl(RELEASES_API, {
    headers: { "User-Agent": "hackl-vscode", Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub releases HTTP ${res.status}`);
  const json = (await res.json()) as ReleaseInfo;
  if (!json.tag_name || !Array.isArray(json.assets)) throw new Error("malformed release payload");
  return json;
}

export function selectAsset(hw: HardwareProfile, assets: ReleaseAsset[]): ReleaseAsset | undefined {
  const patterns = assetPatterns(hw);
  for (const pat of patterns) {
    const match = assets.find((a) => pat.test(a.name));
    if (match) return match;
  }
  return undefined;
}

// Patterns target the May 2026 llama.cpp release naming
// (`llama-<tag>-bin-<platform>-<backend>.{tar.gz,zip}`).
// Order encodes backend preference per host.
export function assetPatterns(hw: HardwareProfile): RegExp[] {
  const out: RegExp[] = [];
  if (hw.platform === "darwin") {
    if (hw.arch === "arm64") {
      out.push(/bin-macos-arm64(?:-kleidiai)?\.tar\.gz$/i);
    } else {
      out.push(/bin-macos-x64\.tar\.gz$/i);
    }
    return out;
  }
  if (hw.platform === "linux") {
    if (hw.arch === "arm64") {
      out.push(/bin-ubuntu-vulkan-arm64\.tar\.gz$/i);
      out.push(/bin-ubuntu-arm64\.tar\.gz$/i);
      return out;
    }
    if (hw.backend === "rocm") out.push(/bin-ubuntu-rocm-[\d.]+-x64\.tar\.gz$/i);
    // No CUDA-specific Linux archive in current releases; Vulkan covers NVIDIA fine.
    if (hw.backend === "cuda" || hw.backend === "vulkan") {
      out.push(/bin-ubuntu-vulkan-x64\.tar\.gz$/i);
    }
    out.push(/bin-ubuntu-x64\.tar\.gz$/i); // CPU fallback
    return out;
  }
  // win32
  const winArch = hw.arch === "arm64" ? "arm64" : "x64";
  if (hw.backend === "cuda") {
    out.push(new RegExp(`bin-win-cuda-13[\\.\\d]*-${winArch}\\.zip$`, "i"));
    out.push(new RegExp(`bin-win-cuda-12[\\.\\d]*-${winArch}\\.zip$`, "i"));
  }
  if (hw.backend === "rocm") out.push(new RegExp(`bin-win-hip[^.]*-${winArch}\\.zip$`, "i"));
  out.push(new RegExp(`bin-win-vulkan-${winArch}\\.zip$`, "i"));
  out.push(new RegExp(`bin-win-cpu-${winArch}\\.zip$`, "i"));
  return out;
}

export async function downloadFile(
  url: string,
  destPath: string,
  progress: ProgressSink,
  fetchImpl: typeof fetch = fetch,
  expectedSha256?: string,
): Promise<void> {
  const tmp = `${destPath}.part`;
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  let startByte = 0;
  try {
    const stat = await fs.promises.stat(tmp);
    startByte = stat.size;
  } catch { /* no resume */ }
  const headers: Record<string, string> = { "User-Agent": "hackl-vscode" };
  if (startByte > 0) headers["Range"] = `bytes=${startByte}-`;
  const res = await fetchImpl(url, { headers });
  if (!res.ok && res.status !== 206) {
    throw new Error(`download HTTP ${res.status}`);
  }
  const total = Number(res.headers.get("content-length") ?? 0) + startByte;
  const body = res.body;
  if (!body) throw new Error("download missing body");
  const out = fs.createWriteStream(tmp, { flags: startByte > 0 ? "a" : "w" });
  let received = startByte;
  const reader = (body as unknown as { getReader: () => ReadableStreamDefaultReader<Uint8Array> }).getReader();
  try {
    while (true) {
      if (progress.isCancelled?.()) {
        await reader.cancel().catch(() => undefined);
        throw new CancellationError();
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        await new Promise<void>((resolve, reject) => {
          out.write(value, (err) => err ? reject(err) : resolve());
        });
        if (total > 0) {
          progress.fraction?.(Math.min(1, received / total));
          progress.message(`${formatBytes(received)} / ${formatBytes(total)}`);
        } else {
          progress.message(`${formatBytes(received)} downloaded`);
        }
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err: unknown) => err ? reject(err) : resolve()));
    if (expectedSha256) {
      progress.message("Verifying sha256...");
      const actual = await sha256File(tmp);
      if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
        await fs.promises.unlink(tmp).catch(() => undefined);
        throw new Error(`sha256 mismatch: expected ${expectedSha256}, got ${actual}`);
      }
    }
    await fs.promises.rename(tmp, destPath);
  } catch (err) {
    out.destroy();
    throw err;
  }
}

export async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  await fs.promises.mkdir(destDir, { recursive: true });
  const isTar = /\.tar\.gz$|\.tgz$|\.tar$/i.test(archivePath);
  if (isTar) {
    await runCmd("tar", ["-xf", archivePath, "-C", destDir]);
    return;
  }
  if (process.platform === "win32") {
    await runCmd("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`,
    ]);
    return;
  }
  try {
    await runCmd("unzip", ["-q", "-o", archivePath, "-d", destDir]);
  } catch {
    await runCmd("tar", ["-xf", archivePath, "-C", destDir]);
  }
}

// Back-compat alias for older callers/tests.
export const extractZip = extractArchive;

export async function findLlamaServer(rootDir: string): Promise<string | undefined> {
  const name = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  for await (const entry of walk(rootDir)) {
    if (path.basename(entry) === name) return entry;
  }
  return undefined;
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

export interface InstallResult {
  binaryPath: string;
  tag: string;
  installDir: string;
}

export async function installLlamaCpp(opts: {
  hw: HardwareProfile;
  installRoot: string;
  progress: ProgressSink;
  fetchImpl?: typeof fetch;
}): Promise<InstallResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (opts.progress.isCancelled?.()) throw new CancellationError();
  opts.progress.message("Fetching latest llama.cpp release...");
  const release = await fetchLatestRelease(fetchImpl);
  const asset = selectAsset(opts.hw, release.assets);
  if (!asset) {
    throw new Error(`No matching llama.cpp asset for ${opts.hw.platform}/${opts.hw.arch}/${opts.hw.backend}`);
  }
  const tagDir = path.join(opts.installRoot, release.tag_name);
  const existing = await findLlamaServer(tagDir).catch(() => undefined);
  if (existing) {
    return { binaryPath: existing, tag: release.tag_name, installDir: tagDir };
  }
  const archivePath = path.join(opts.installRoot, "downloads", asset.name);
  const expectedSha = parseDigest(asset.digest);
  opts.progress.message(`Downloading ${asset.name}${expectedSha ? "" : " (no sha256 published)"}...`);
  await downloadFile(asset.browser_download_url, archivePath, opts.progress, fetchImpl, expectedSha);
  opts.progress.message("Extracting...");
  await extractArchive(archivePath, tagDir);
  await fs.promises.unlink(archivePath).catch(() => undefined);
  const binary = await findLlamaServer(tagDir);
  if (!binary) throw new Error("llama-server binary not found in extracted archive");
  if (process.platform !== "win32") {
    await fs.promises.chmod(binary, 0o755).catch(() => undefined);
  }
  return { binaryPath: binary, tag: release.tag_name, installDir: tagDir };
}

export function parseDigest(digest: string | undefined): string | undefined {
  if (!digest) return undefined;
  const m = /^sha256:([0-9a-f]{64})$/i.exec(digest);
  return m?.[1];
}

function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: "ignore" });
    c.on("error", reject);
    c.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`)));
  });
}
