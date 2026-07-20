import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { HacklTarget } from "./types";
import type { HacklAnnotation } from "./types";
import type { PromptMode } from "./prompt";

export interface HacklSessionRecord {
  id: string;
  createdAt: string;
  mode: PromptMode;
  endpoint?: string;
  model?: string;
  backendKind?: "local" | "codex";
  gitHead?: string;
  targets: HacklTarget[];
  answer?: string;
  annotations: HacklAnnotation[];
}

let counter = 0;

export function newHacklSessionId(): string {
  counter += 1;
  return `hs-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export async function persistHacklSession(
  storageRoot: string,
  session: HacklSessionRecord,
): Promise<string | undefined> {
  if (!storageRoot) return undefined;
  const dir = path.join(storageRoot, "sessions");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${session.id}.json`);
  await fs.writeFile(file, JSON.stringify(session, null, 2), "utf8");
  return file;
}

export async function pruneSessionsOnDisk(storageRoot: string, retainCount: number): Promise<void> {
  if (!storageRoot) return;
  const dir = path.join(storageRoot, "sessions");
  const exists = await fs.stat(dir).then(() => true, () => false);
  if (!exists) return;
  await pruneOldSessions(dir, retainCount);
}

async function pruneOldSessions(dir: string, retainCount: number): Promise<void> {
  if (retainCount <= 0) return;
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const files = entries.filter((f) => f.startsWith("hs-") && f.endsWith(".json"));
  if (files.length <= retainCount) return;
  const stats = await Promise.all(
    files.map(async (f) => {
      const full = path.join(dir, f);
      const st = await fs.stat(full).catch(() => undefined);
      return st ? { full, mtime: st.mtimeMs } : undefined;
    }),
  );
  const sorted = stats
    .filter((s): s is { full: string; mtime: number } => Boolean(s))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of sorted.slice(retainCount)) {
    await fs.unlink(old.full).catch(() => undefined);
  }
}
