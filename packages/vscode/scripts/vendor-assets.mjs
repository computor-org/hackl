// Single source of truth for the browser libraries the chat webview loads.
// scripts/sync-vendor.mjs copies these files into media/vendor and
// tests/vendorSync.test.cjs checks the committed copies against the same
// table, so the shipped files and the check cannot drift apart.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

/** packages/vscode */
export const packageDir = path.resolve(scriptDir, "..");
/** hackl monorepo root */
export const repoRoot = path.resolve(packageDir, "..", "..");

/** media/vendor inside this package. */
export const vendorDir = path.join(packageDir, "media", "vendor");

/**
 * Each entry maps one installed devDependency onto the files the webview
 * needs. `dest` is relative to media/vendor and is the name chatHtml.ts
 * loads, which does not always match the upstream file name.
 */
export const VENDOR_PACKAGES = [
  {
    pkg: "markdown-it",
    // markdown-it 15 ships its browser bundle under dist/browser/ instead of
    // dist/markdown-it.min.js. It is a prebuilt minified UMD bundle, copied
    // unchanged under the name chatHtml.ts references.
    files: [{ source: "dist/browser/markdown-it.umd.min.js", dest: "markdown-it/markdown-it.min.js" }],
    licenses: ["LICENSE"],
  },
  {
    pkg: "katex",
    files: [
      { source: "dist/katex.min.js", dest: "katex/katex.min.js" },
      { source: "dist/katex.min.css", dest: "katex/katex.min.css" },
    ],
    // Fonts are taken from the @font-face rules the vendored stylesheet
    // actually references, so a release that drops a font drops it here too.
    fontsFrom: "dist/katex.min.css",
    licenses: ["LICENSE"],
  },
  {
    pkg: "@vscode/codicons",
    files: [
      { source: "dist/codicon.css", dest: "codicons/codicon.css" },
      { source: "dist/codicon.ttf", dest: "codicons/codicon.ttf" },
    ],
    licenses: ["LICENSE", "LICENSE-CODE"],
  },
];

/** Root of the installed copy of `pkg`, honouring workspace nesting. */
export function packageRoot(pkg) {
  for (const base of [packageDir, repoRoot]) {
    const candidate = path.join(base, "node_modules", pkg);
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }
  throw new Error(
    `${pkg} is not installed. Run \`npm ci\` in ${repoRoot} before syncing vendor assets.`,
  );
}

export function packageVersion(pkg) {
  return JSON.parse(readFileSync(path.join(packageRoot(pkg), "package.json"), "utf8")).version;
}

/** Font file names referenced by a KaTeX stylesheet, relative to fonts/. */
export function referencedFonts(cssFile) {
  const css = readFileSync(cssFile, "utf8");
  return [...new Set([...css.matchAll(/url\(\s*fonts\/([^")?#]+)/g)].map((match) => match[1]))].sort();
}

/**
 * Full copy plan: [{ pkg, version, source, dest }] with absolute paths,
 * sorted by dest. Throws when the locked package no longer ships a file the
 * webview needs, because a missing browser bundle must never be hand-built.
 */
export function vendorPlan() {
  const plan = [];
  for (const entry of VENDOR_PACKAGES) {
    const root = packageRoot(entry.pkg);
    const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
    for (const file of entry.files) {
      const source = path.join(root, file.source);
      if (!existsSync(source)) {
        throw new Error(
          `${entry.pkg}@${version} does not ship ${file.source}. ` +
            "The webview needs a prebuilt browser bundle; stop and update the table " +
            "or the loader instead of building one by hand.",
        );
      }
      plan.push({ pkg: entry.pkg, version, source, dest: path.join(vendorDir, file.dest) });
    }
    if (entry.fontsFrom) {
      const css = path.join(root, entry.fontsFrom);
      if (!existsSync(css)) {
        throw new Error(`${entry.pkg}@${version} does not ship ${entry.fontsFrom}.`);
      }
      for (const font of referencedFonts(css)) {
        const source = path.join(root, path.dirname(entry.fontsFrom), "fonts", font);
        if (!existsSync(source)) {
          throw new Error(`${entry.pkg}@${version} references fonts/${font} but does not ship it.`);
        }
        plan.push({ pkg: entry.pkg, version, source, dest: path.join(vendorDir, "katex", "fonts", font) });
      }
    }
    for (const license of entry.licenses) {
      const source = path.join(root, license);
      if (!existsSync(source)) {
        throw new Error(`${entry.pkg}@${version} ships no ${license}; the vendored license cannot be kept.`);
      }
      plan.push({ pkg: entry.pkg, version, source, dest: path.join(vendorDir, "licenses", entry.pkg.replace("@vscode/", ""), license) });
    }
  }
  return plan.sort((a, b) => (a.dest < b.dest ? -1 : 1));
}
