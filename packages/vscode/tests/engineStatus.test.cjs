const assert = require("node:assert/strict");
const test = require("node:test");
const { engineStatusDisplay } = require("../dist/engineStatus.js");

test("managed-server display distinguishes persisted off and external endpoints", () => {
  const off = engineStatusDisplay(false, false);
  assert.match(off.text, /off/);
  assert.match(off.tooltip, /External endpoints are unaffected/);

  const external = engineStatusDisplay(true, true);
  assert.match(external.text, /external/);
  assert.match(external.tooltip, /never stop it/);
});

test("managed-server display exposes foreground ownership and sharing", () => {
  const display = engineStatusDisplay(true, false, {
    state: "running-managed",
    hostMode: "foreground",
    endpoint: "http://127.0.0.1:8080/v1",
    alias: "qwen3.5-9b-q4",
    owner: "serve",
    leases: 3,
  });
  assert.match(display.text, /qwen3\.5-9b-q4/);
  assert.match(display.tooltip, /foreground terminal/);
  assert.match(display.tooltip, /3 clients/);
});

test("unstarted managed server explains the lazy-start action", () => {
  const display = engineStatusDisplay(true, false);
  assert.match(display.text, /unavailable/);
  assert.match(display.tooltip, /start it/);
});

test("auto-discovered external server is visibly read-only", () => {
  const display = engineStatusDisplay(true, false, {
    state: "running-external",
    hostMode: "leased",
    endpoint: "http://127.0.0.1:1234/v1",
    model: "external-model",
    leases: 1,
  });
  assert.match(display.text, /external/);
  assert.match(display.tooltip, /never stop it/);
});
