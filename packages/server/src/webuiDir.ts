import * as fs from "node:fs";
import * as path from "node:path";

// Locate the built @hackl/webui static assets across the monorepo dev layout
// and a packaged layout. Returns undefined when no bundle is present (the
// server then runs UI-less and only accepts WebSocket clients).
export function resolveWebuiDir(): string | undefined {
  const candidates = [
    path.resolve(__dirname, "../../webui/dist"),
    path.resolve(__dirname, "webui"),
    path.resolve(__dirname, "../webui/dist"),
  ];
  for (const dir of candidates) {
    try {
      if (fs.statSync(path.join(dir, "index.html")).isFile()) return dir;
    } catch {
      // try next
    }
  }
  return undefined;
}
