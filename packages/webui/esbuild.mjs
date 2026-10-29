import esbuild from "esbuild";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { katexCss, katexFonts } from "./scripts/katex-assets.mjs";

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
writeFileSync("dist/katex.css", katexCss());
mkdirSync("dist/fonts", { recursive: true });
for (const [name, data] of Object.entries(katexFonts())) writeFileSync(`dist/${name}`, data);
