const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const {
  detectCodex,
  clearCodexDetectionCache,
  codexCommandCandidates,
  parseCodexModelCatalog,
  parseModelsFromTomlText,
  DEFAULT_CODEX_MODELS,
} = require("../dist/codexDetect.js");

async function tmpHome(authJson, configToml) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hackl-codex-"));
  if (authJson !== undefined) await fs.writeFile(path.join(dir, "auth.json"), authJson);
  if (configToml !== undefined) await fs.writeFile(path.join(dir, "config.toml"), configToml);
  return dir;
}

test("detectCodex reports missing CLI without crashing", async () => {
  clearCodexDetectionCache();
  const home = await tmpHome("", "");
  const result = await detectCodex({ command: "/definitely/not/a/binary", codexHome: home, force: true });
  assert.equal(result.available, false);
  assert.equal(result.authMode, "none");
});

test("codexCommandCandidates searches common user install locations", () => {
  const candidates = codexCommandCandidates("codex", "/home/example");
  assert.deepEqual(candidates.slice(0, 3), [
    "codex",
    "/home/example/.npm-global/bin/codex",
    "/home/example/.local/bin/codex",
  ]);
});

test("codexCommandCandidates preserves explicit command paths", () => {
  assert.deepEqual(codexCommandCandidates("/custom/bin/codex", "/home/example"), ["/custom/bin/codex"]);
});

test("parseModelsFromTomlText collects only the top-level Codex model", () => {
  const text = `model = "gpt-5.5"\n[profiles.work]\nmodel = "qwen"\n[profiles.openrouter]\nmodel = "qwen/qwen3.6-plus-preview:free"\n`;
  const result = parseModelsFromTomlText(text);
  assert.deepEqual(result, ["gpt-5.5"]);
});

test("parseModelsFromTomlText ignores profile-only provider models", () => {
  const text = `[profiles.local]\nmodel = "qwen"\n[profiles.openrouter]\nmodel = "qwen/qwen3.6-plus-preview:free"\n`;
  assert.deepEqual(parseModelsFromTomlText(text), []);
});

test("DEFAULT_CODEX_MODELS matches the Codex selector model set", () => {
  for (const m of ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"]) {
    assert.ok(DEFAULT_CODEX_MODELS.includes(m), `missing default ${m}`);
  }
  assert.equal(DEFAULT_CODEX_MODELS.includes("qwen"), false);
});

test("parseCodexModelCatalog reads visible models and effective context windows", () => {
  const result = parseCodexModelCatalog({
    models: [
      { slug: "gpt-5.4-mini", visibility: "list", context_window: 272000, effective_context_window_percent: 95 },
      { slug: "hidden", visibility: "hidden", context_window: 999 },
      { slug: "gpt-5.3-codex-spark", visibility: "list", context_window: 128000, effective_context_window_percent: 95 },
    ],
  });
  assert.deepEqual(result.models, ["gpt-5.4-mini", "gpt-5.3-codex-spark"]);
  assert.equal(result.modelContextWindows["gpt-5.4-mini"], 258400);
  assert.equal(result.modelContextWindows["gpt-5.3-codex-spark"], 121600);
  assert.equal(result.modelContextWindows.hidden, undefined);
});

test("auth.json parsing maps chatgpt/apikey/none", async () => {
  clearCodexDetectionCache();
  // We exercise readAuthMode indirectly by stubbing version detection: point
  // command at /bin/true so it always exits 0.
  const home1 = await tmpHome(JSON.stringify({ auth_mode: "chatgpt" }), "");
  const r1 = await detectCodex({ command: "/bin/true", codexHome: home1, force: true });
  assert.equal(r1.authMode, "chatgpt");

  clearCodexDetectionCache();
  const home2 = await tmpHome(JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-x" }), "");
  const r2 = await detectCodex({ command: "/bin/true", codexHome: home2, force: true });
  assert.equal(r2.authMode, "apikey");

  clearCodexDetectionCache();
  const home3 = await tmpHome("{ not valid json", "");
  const r3 = await detectCodex({ command: "/bin/true", codexHome: home3, force: true });
  assert.equal(r3.authMode, "none");

  clearCodexDetectionCache();
  const home4 = await tmpHome(JSON.stringify({ OPENAI_API_KEY: "sk-x" }), "");
  const r4 = await detectCodex({ command: "/bin/true", codexHome: home4, force: true });
  assert.equal(r4.authMode, "apikey");
});
