const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const {
  detectCodex,
  clearCodexDetectionCache,
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

test("parseModelsFromTomlText collects model= and [model_presets.X] entries", () => {
  const text = `model = "gpt-5-codex"\n[profiles.work]\nmodel = "gpt-5.5"\n[model_presets.fast]\nfoo = 1\n[model_presets.deep]\n`;
  const result = parseModelsFromTomlText(text);
  assert.ok(result.includes("gpt-5-codex"));
  assert.ok(result.includes("gpt-5.5"));
  assert.ok(result.includes("fast"));
  assert.ok(result.includes("deep"));
});

test("DEFAULT_CODEX_MODELS includes a stable set", () => {
  for (const m of ["gpt-5-codex", "gpt-5.1-codex", "gpt-5.5"]) {
    assert.ok(DEFAULT_CODEX_MODELS.includes(m), `missing default ${m}`);
  }
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
