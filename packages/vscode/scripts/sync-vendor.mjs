#!/usr/bin/env node
// Refresh the browser libraries the chat webview loads from the versions
// locked in package-lock.json. Run `npm ci` first, then `npm run sync:vendor`
// in packages/vscode, and commit media/vendor together with the lockfile bump.
//
// The file table lives in scripts/vendor-assets.mjs and is checked by
// tests/vendorSync.test.cjs.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { packageVersion, repoRoot, vendorDir, vendorPlan } from "./vendor-assets.mjs";

const scanRoots = [
  path.join(vendorDir, "..", "..", "src"),
  path.join(vendorDir, "..", "chat"),
  path.join(vendorDir, "..", "scripts"),
];

const plan = vendorPlan();
const expected = new Map(plan.map((entry) => [entry.dest, entry]));
const written = [];
const unchanged = [];

for (const entry of plan) {
  const bytes = readFileSync(entry.source);
  const before = existsSync(entry.dest) ? readFileSync(entry.dest) : null;
  if (before && bytes.equals(before)) {
    unchanged.push(entry.dest);
    continue;
  }
  mkdirSync(path.dirname(entry.dest), { recursive: true });
  writeFileSync(entry.dest, bytes, { mode: 0o644 });
  written.push(entry.dest);
  console.log(
    `wrote ${relative(entry.dest)}  (${entry.pkg}@${entry.version}, ${sha256(bytes)})`,
  );
}

const orphans = listFiles(vendorDir).filter((file) => !expected.has(file));
const removed = [];
for (const orphan of orphans) {
  const referenced = referencingFiles(orphan);
  if (referenced.length > 0) {
    fail(`${relative(orphan)} is not shipped by the locked packages but is still referenced by:\n  ${referenced.map(relative).join("\n  ")}`);
  }
  rmSync(orphan);
  removed.push(orphan);
  console.log(`removed ${relative(orphan)} (no longer shipped, no reference found)`);
}

pruneEmptyDirs(vendorDir);

console.log("");
console.log(`vendor packages: ${["markdown-it", "katex", "@vscode/codicons"].map((pkg) => `${pkg}@${packageVersion(pkg)}`).join(", ")}`);
console.log(`${written.length} updated, ${unchanged.length} unchanged, ${removed.length} removed, ${plan.length} vendored files total`);
if (written.length === 0 && removed.length === 0) {
  console.log("media/vendor already matches the locked packages");
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

// A vendored file is only deleted when no source, stylesheet or script in the
// extension mentions its name, so a loader that was missed keeps the run red.
function referencingFiles(target) {
  const needle = path.basename(target);
  const hits = [];
  for (const root of scanRoots) {
    if (!existsSync(root)) continue;
    for (const file of listFiles(root)) {
      if (file === target) continue;
      if (!/\.(ts|js|css|html|json|mjs|cjs)$/.test(file)) continue;
      if (readFileSync(file, "utf8").includes(needle)) hits.push(file);
    }
  }
  return hits;
}

function pruneEmptyDirs(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) pruneEmptyDirs(full);
  }
  if (dir !== vendorDir && readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
}

function relative(file) {
  return path.relative(repoRoot, file);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

function fail(message) {
  console.error(`sync-vendor: ${message}`);
  process.exit(1);
}
