import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Minimal static file server for the bundled web UI, with an SPA fallback to
// index.html. Path traversal is blocked by resolving under the root. baseHeaders
// (CSP, Referrer-Policy) are applied to every response.
export function createStaticHandler(
  dir: string,
  baseHeaders: Record<string, string> = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  const root = path.resolve(dir);
  return (req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const filePath = path.resolve(root, rel);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      res.writeHead(403, baseHeaders);
      res.end("forbidden");
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        fs.readFile(path.join(root, "index.html"), (fallbackErr, index) => {
          if (fallbackErr) {
            res.writeHead(404, baseHeaders);
            res.end("not found");
            return;
          }
          res.writeHead(200, { ...baseHeaders, "content-type": "text/html; charset=utf-8" });
          res.end(index);
        });
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { ...baseHeaders, "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
      res.end(data);
    });
  };
}

export function createStaticAssetHandler(
  assets: Record<string, string>,
  baseHeaders: Record<string, string> = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const name = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const exact = assets[name];
    const body = exact ?? assets["index.html"];
    if (body === undefined) {
      res.writeHead(404, baseHeaders);
      res.end("not found");
      return;
    }
    const ext = path.extname(exact === undefined ? "index.html" : name).toLowerCase();
    res.writeHead(200, { ...baseHeaders, "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
    res.end(body);
  };
}
