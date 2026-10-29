const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// The chat webview loads committed copies of markdown-it, KaTeX and Codicons.
// Dependabot only bumps the npm entries, so these checks keep the committed
// copies honest: every vendored byte must equal the byte the lockfile installs.

const packageDir = path.resolve(__dirname, "..");
const srcDir = path.join(packageDir, "src");

async function assets() {
  return import(path.join(packageDir, "scripts", "vendor-assets.mjs"));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

test("every vendored file equals the copy the lockfile installs", async () => {
  const { vendorPlan } = await assets();
  const plan = vendorPlan();
  assert.ok(plan.length >= 60, `expected the full KaTeX font set in the plan, got ${plan.length}`);
  const stale = [];
  for (const entry of plan) {
    if (!fs.existsSync(entry.dest)) {
      stale.push(`${rel(entry.dest)} is missing`);
    } else if (sha256(entry.dest) !== sha256(entry.source)) {
      stale.push(`${rel(entry.dest)} is not the ${entry.pkg}@${entry.version} copy`);
    }
  }
  assert.deepEqual(
    stale,
    [],
    `${stale.length} vendored files are out of step with the lockfile; run npm run sync:vendor:\n  ${stale.join("\n  ")}`,
  );
});

test("media/vendor holds nothing the locked packages do not ship", async () => {
  const { vendorDir, vendorPlan } = await assets();
  const expected = new Set(vendorPlan().map((entry) => entry.dest));
  const extra = listFiles(vendorDir).filter((file) => !expected.has(file));
  assert.deepEqual(extra.map(rel), [], "stale vendored files; delete them after checking references");
});

test("the locked versions are the versions the webview loads", async () => {
  const { packageVersion, vendorDir } = await assets();
  const katex = packageVersion("katex");
  for (const file of ["katex/katex.min.js", "katex/katex.min.css"]) {
    const content = fs.readFileSync(path.join(vendorDir, file), "utf8");
    assert.ok(
      content.includes(katex),
      `${file} has no "KaTeX ${katex}" version string in it`,
    );
  }
  const declared = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")).devDependencies;
  for (const pkg of ["markdown-it", "katex", "@vscode/codicons"]) {
    assert.ok(
      satisfiesCaret(declared[pkg], packageVersion(pkg)),
      `${pkg}@${packageVersion(pkg)} does not satisfy the declared range ${declared[pkg]}`,
    );
  }
});

// Caret semantics for the ranges this package declares: a 0.x range pins the
// minor, everything else pins the major.
function satisfiesCaret(range, version) {
  const want = range.replace(/^\^/, "").split(".").map(Number);
  const have = version.split(".").map(Number);
  if (Number.isNaN(want[0]) || Number.isNaN(have[0])) return false;
  const pinned = want[0] === 0 ? 2 : 1;
  for (let i = 0; i < pinned; i += 1) {
    if ((have[i] ?? 0) !== (want[i] ?? 0)) return false;
  }
  for (let i = pinned; i < 3; i += 1) {
    if ((have[i] ?? 0) < (want[i] ?? 0)) return false;
    if ((have[i] ?? 0) > (want[i] ?? 0)) return true;
  }
  return true;
}

test("chatHtml.ts loads vendored paths that exist", () => {
  const html = fs.readFileSync(path.join(srcDir, "chatHtml.ts"), "utf8");
  const loaded = [...html.matchAll(/joinPath\(extensionUri, "media", "vendor", "([^"]+)", "([^"]+)"\)/g)];
  assert.equal(loaded.length, 4, "expected markdown-it, katex js, katex css and codicon css in chatHtml.ts");
  for (const [, dir, file] of loaded) {
    assert.ok(
      fs.existsSync(path.join(packageDir, "media", "vendor", dir, file)),
      `chatHtml.ts loads media/vendor/${dir}/${file}, which is not committed`,
    );
  }
});

function rel(file) {
  return path.relative(packageDir, file);
}
