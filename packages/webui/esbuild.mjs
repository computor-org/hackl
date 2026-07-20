import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

// Bundle the browser app to one IIFE. @hackl/protocol resolves from source; its
// type-only re-exports of @hackl/core are erased, so no Node code is pulled in.
mkdirSync("dist", { recursive: true });
await esbuild.build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  conditions: ["source"],
  logLevel: "info",
});
copyFileSync("src/index.html", "dist/index.html");
copyFileSync("src/main.css", "dist/main.css");
