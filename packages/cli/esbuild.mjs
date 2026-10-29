import esbuild from "esbuild";
import { readFileSync } from "node:fs";
import { katexCss, katexFonts } from "../webui/scripts/katex-assets.mjs";

const browser = await esbuild.build({
  entryPoints: ["../webui/src/main.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  conditions: ["source"],
  write: false,
  logLevel: "silent",
});
// Fonts are binary: base64 here, Buffers in the generated module.
const fonts = Object.fromEntries(Object.entries(katexFonts()).map(([name, data]) => [name, data.toString("base64")]));
const assets = {
  "index.html": readFileSync("../webui/src/index.html", "utf8"),
  "main.css": readFileSync("../webui/src/main.css", "utf8"),
  "katex.css": katexCss(),
  "main.js": browser.outputFiles[0].text,
};
const webuiAssets = {
  name: "hackl-webui-assets",
  setup(build) {
    build.onResolve({ filter: /^hackl-webui-assets$/ }, () => ({ path: "assets", namespace: "hackl-webui" }));
    build.onLoad({ filter: /.*/, namespace: "hackl-webui" }, () => ({
      contents: `const fonts = ${JSON.stringify(fonts)};
export default { ...${JSON.stringify(assets)}, ...Object.fromEntries(Object.entries(fonts).map(([name, b64]) => [name, Buffer.from(b64, "base64")])) };`,
      loader: "js",
    }));
  },
};

// Bundle the CLI into a single self-contained file with a shebang. @hackl/core
// is resolved from source (the "source" export condition) so esbuild inlines
// the whole backend AND the ESM-only MCP SDK; the result needs no node_modules.
await esbuild.build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  conditions: ["source"],
  plugins: [webuiAssets],
  logLevel: "info",
});
