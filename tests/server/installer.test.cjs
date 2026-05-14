const assert = require("node:assert/strict");
const test = require("node:test");
const { selectAsset, assetPatterns, parseDigest } = require("../../dist/server/installer.js");

function asset(name, digest) {
  return { name, browser_download_url: `https://x/${name}`, size: 1, digest };
}

test("Linux NVIDIA picks the vulkan asset (current releases ship no Linux CUDA archive)", () => {
  const assets = [
    asset("llama-b9145-bin-ubuntu-vulkan-x64.tar.gz"),
    asset("llama-b9145-bin-ubuntu-x64.tar.gz"),
    asset("llama-b9145-bin-ubuntu-rocm-7.2-x64.tar.gz"),
  ];
  const hw = { platform: "linux", arch: "x64", backend: "cuda" };
  const picked = selectAsset(hw, assets);
  assert.equal(picked.name, "llama-b9145-bin-ubuntu-vulkan-x64.tar.gz");
});

test("Linux ROCm picks the rocm asset", () => {
  const assets = [
    asset("llama-b9145-bin-ubuntu-rocm-7.2-x64.tar.gz"),
    asset("llama-b9145-bin-ubuntu-vulkan-x64.tar.gz"),
    asset("llama-b9145-bin-ubuntu-x64.tar.gz"),
  ];
  const hw = { platform: "linux", arch: "x64", backend: "rocm" };
  assert.equal(selectAsset(hw, assets).name, "llama-b9145-bin-ubuntu-rocm-7.2-x64.tar.gz");
});

test("Pure CPU Linux falls back to ubuntu-x64.tar.gz", () => {
  const assets = [
    asset("llama-b9145-bin-ubuntu-vulkan-x64.tar.gz"),
    asset("llama-b9145-bin-ubuntu-x64.tar.gz"),
  ];
  const hw = { platform: "linux", arch: "x64", backend: "cpu" };
  assert.equal(selectAsset(hw, assets).name, "llama-b9145-bin-ubuntu-x64.tar.gz");
});

test("macOS arm64 picks the macos-arm64 tar.gz", () => {
  const assets = [
    asset("llama-b9145-bin-macos-arm64.tar.gz"),
    asset("llama-b9145-bin-macos-x64.tar.gz"),
  ];
  const hw = { platform: "darwin", arch: "arm64", backend: "metal" };
  assert.equal(selectAsset(hw, assets).name, "llama-b9145-bin-macos-arm64.tar.gz");
});

test("Windows CUDA prefers cuda-13 over cuda-12", () => {
  const assets = [
    asset("llama-b9145-bin-win-cuda-12.4-x64.zip"),
    asset("llama-b9145-bin-win-cuda-13.1-x64.zip"),
    asset("llama-b9145-bin-win-vulkan-x64.zip"),
  ];
  const hw = { platform: "win32", arch: "x64", backend: "cuda" };
  assert.equal(selectAsset(hw, assets).name, "llama-b9145-bin-win-cuda-13.1-x64.zip");
});

test("No matching asset returns undefined", () => {
  const hw = { platform: "linux", arch: "x64", backend: "cuda" };
  assert.equal(selectAsset(hw, [asset("unrelated.tar.gz")]), undefined);
});

test("assetPatterns puts vulkan-arm64 first for linux-arm64", () => {
  const hw = { platform: "linux", arch: "arm64", backend: "cpu" };
  const pats = assetPatterns(hw);
  assert.ok(pats[0].test("llama-b9145-bin-ubuntu-vulkan-arm64.tar.gz"));
});

test("parseDigest extracts sha256 hex and rejects malformed input", () => {
  const hex = "a".repeat(64);
  assert.equal(parseDigest("sha256:" + hex), hex);
  assert.equal(parseDigest("sha256:" + hex.toUpperCase()), hex.toUpperCase());
  assert.equal(parseDigest("md5:" + hex), undefined);
  assert.equal(parseDigest("sha256:tooshort"), undefined);
  assert.equal(parseDigest(undefined), undefined);
});
