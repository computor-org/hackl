const assert = require("node:assert/strict");
const test = require("node:test");
const {
  chatViewContainer,
  supportsSecondarySidebar,
} = require("../dist/viewLocation.js");

test("secondary sidebar support follows the VS Code 1.106 boundary", () => {
  assert.equal(supportsSecondarySidebar("1.105.2"), false);
  assert.equal(supportsSecondarySidebar("1.106.0"), true);
  assert.equal(supportsSecondarySidebar("1.133.0"), true);
  assert.equal(supportsSecondarySidebar("1.133.0-insider"), true);
  assert.equal(supportsSecondarySidebar("bad"), false);
});

test("chat opens in the matching fallback or secondary-sidebar view", () => {
  assert.deepEqual(chatViewContainer("1.105.2"), {
    container: "hackl.activitybar",
    view: "hackl.chatActivitybar",
  });
  assert.deepEqual(chatViewContainer("1.106.0"), {
    container: "hackl",
    view: "hackl.chatView",
  });
});
