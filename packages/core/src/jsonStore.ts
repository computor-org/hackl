import * as fs from "node:fs";
import * as path from "node:path";

// Small atomic JSON read/write helper shared by the CLI config writer and the
// engine. Write to a temp file then rename so a concurrent reader never sees a
// half-written file and two writers can't corrupt each other (last writer wins).

export function readJsonFile<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function writeJsonFileAtomic(file: string, value: unknown): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}
