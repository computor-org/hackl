// KaTeX's stylesheet and woff2 fonts for the web UI. The CLI embeds the UI in
// packages/cli/esbuild.mjs, so both build scripts read the files through here.
// The legacy woff/ttf sources are dropped because every browser this UI runs in
// reads woff2; the CSP then needs no font allowance beyond 'self'.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cssPath = require.resolve("katex/dist/katex.min.css");
const fontDir = path.join(path.dirname(cssPath), "fonts");

/** KaTeX's minified stylesheet, fonts referenced as fonts/*.woff2 next to it. */
export function katexCss() {
  return readFileSync(cssPath, "utf8").replace(/,url\([^)]*\.(?:woff|ttf)\)( format\("(?:woff|truetype)"\))?/g, "");
}

/** The woff2 fonts as { "fonts/<name>": Buffer }. */
export function katexFonts() {
  const fonts = {};
  for (const name of readdirSync(fontDir).filter((file) => file.endsWith(".woff2"))) {
    fonts[`fonts/${name}`] = readFileSync(path.join(fontDir, name));
  }
  return fonts;
}
