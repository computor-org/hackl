const assert = require("node:assert/strict");
const test = require("node:test");
const { updateEngineEnabled } = require("../dist/engineSetting.js");

test("the engine toggle writes the inverse setting", async () => {
  const writes = [];
  const result = await updateEngineEnabled(true, async (next) => writes.push(next));

  assert.equal(result, "updated");
  assert.deepEqual(writes, [false]);
});

test("a stale configuration registry requests a window reload", async () => {
  const result = await updateEngineEnabled(false, async () => {
    throw new Error("Unable to write because hackl.engine.enabled is not a registered configuration.");
  });

  assert.equal(result, "reload-required");
});

test("unrelated write failures remain errors", async () => {
  await assert.rejects(
    updateEngineEnabled(true, async () => { throw new Error("settings file is read-only"); }),
    /read-only/,
  );
});
