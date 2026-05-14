import * as fs from "node:fs";
import * as path from "node:path";
import { ModelEntry } from "./catalog";
import { downloadFile, sha256File, ProgressSink } from "./installer";

const HF_BASE = "https://huggingface.co";

export interface ModelFileInfo {
  modelId: string;
  path: string;
  exists: boolean;
  sizeBytes?: number;
}

export function modelFilePath(modelsRoot: string, model: ModelEntry): string {
  return path.join(modelsRoot, model.id, model.ggufFile);
}

export async function inspectModel(modelsRoot: string, model: ModelEntry): Promise<ModelFileInfo> {
  const filePath = modelFilePath(modelsRoot, model);
  try {
    const stat = await fs.promises.stat(filePath);
    return { modelId: model.id, path: filePath, exists: true, sizeBytes: stat.size };
  } catch {
    return { modelId: model.id, path: filePath, exists: false };
  }
}

export async function ensureModelDownloaded(opts: {
  modelsRoot: string;
  model: ModelEntry;
  progress: ProgressSink;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const dest = modelFilePath(opts.modelsRoot, opts.model);
  const info = await inspectModel(opts.modelsRoot, opts.model);
  if (info.exists) {
    if (opts.model.sha256) {
      opts.progress.message(`Verifying ${opts.model.ggufFile}...`);
      const hash = await sha256File(dest);
      if (hash !== opts.model.sha256) {
        opts.progress.message("Checksum mismatch — redownloading.");
        await fs.promises.unlink(dest).catch(() => undefined);
      } else {
        return dest;
      }
    } else {
      return dest;
    }
  }
  const url = `${HF_BASE}/${opts.model.hfRepo}/resolve/main/${opts.model.ggufFile}`;
  opts.progress.message(`Downloading ${opts.model.ggufFile} from ${opts.model.hfRepo}...`);
  await downloadFile(url, dest, opts.progress, opts.fetchImpl ?? fetch);
  if (opts.model.sha256) {
    const hash = await sha256File(dest);
    if (hash !== opts.model.sha256) {
      throw new Error(`Checksum mismatch for ${opts.model.ggufFile}`);
    }
  }
  return dest;
}

export async function diskFreeBytes(dir: string): Promise<number | undefined> {
  try {
    const statfs = (fs as unknown as { statfs?: (p: string) => Promise<{ bavail: bigint; bsize: bigint }> }).statfs;
    if (!statfs) return undefined;
    await fs.promises.mkdir(dir, { recursive: true });
    const s = await statfs(dir);
    return Number(s.bavail * s.bsize);
  } catch {
    return undefined;
  }
}
