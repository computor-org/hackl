import assert from "node:assert/strict";
import test from "node:test";
import { releaseChannel, validateGitHubRelease } from "../scripts/release-channel.mjs";
import { vsceArgs } from "../scripts/vsce.mjs";

test("odd minor versions are pre-releases and even minor versions are stable", () => {
  assert.equal(releaseChannel("0.3.0"), "pre-release");
  assert.equal(releaseChannel("0.3.7"), "pre-release");
  assert.equal(releaseChannel("0.4.0"), "stable");
  assert.throws(() => releaseChannel("0.3.0-beta.1"), /major\.minor\.patch/);
});

test("GitHub release metadata must match the package version and channel", () => {
  assert.equal(validateGitHubRelease("0.3.0", "v0.3.0", true), "pre-release");
  assert.equal(validateGitHubRelease("0.4.0", "v0.4.0", false), "stable");
  assert.throws(() => validateGitHubRelease("0.3.0", "v0.3.0", false), /must be true/);
  assert.throws(() => validateGitHubRelease("0.3.0", "v0.3.1", true), /must match/);
});

test("VSCE receives the pre-release flag only for odd minor versions", () => {
  assert.ok(vsceArgs("package", "0.3.0").includes("--pre-release"));
  assert.ok(vsceArgs("publish", "0.3.0", true).includes("--azure-credential"));
  assert.ok(!vsceArgs("package", "0.4.0").includes("--pre-release"));
});
