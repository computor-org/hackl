const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyHacklConfigurationChange } = require("../dist/configurationChange.js");

function changed(...sections) {
  return {
    affectsConfiguration: (candidate) => sections.includes(candidate),
  };
}

test("connection settings trigger immediate chat state refresh", () => {
  for (const key of ["hackl.endpoint", "hackl.model", "hackl.codex.enabled", "hackl.codex.command", "hackl.codex.model"]) {
    assert.equal(classifyHacklConfigurationChange(changed(key)).connection, true, key);
  }
});

test("local selection changes are distinguished from Codex detection changes", () => {
  assert.deepEqual(classifyHacklConfigurationChange(changed("hackl.endpoint")), {
    connection: true,
    localSelection: true,
    codexSelection: false,
    codexDetection: false,
  });
  assert.deepEqual(classifyHacklConfigurationChange(changed("hackl.codex.command")), {
    connection: true,
    localSelection: false,
    codexSelection: false,
    codexDetection: true,
  });
});

test("unrelated Hackl settings do not reconnect the model", () => {
  assert.equal(classifyHacklConfigurationChange(changed("hackl.debug")).connection, false);
  assert.equal(classifyHacklConfigurationChange(changed("hackl.autocomplete.maxTokens")).connection, false);
});
