const assert = require("node:assert/strict");
const test = require("node:test");
const { selectAsset, assetPatterns } = require("../../dist/server/installer.js");

function asset(name) { return { name, browser_download_url: `https://x/${name}`, size: 1 }; }

test("Linux NVIDIA prefers cuda over vulkan and avoids cuda-dlls", () => {
  const assets = [
    asset("llama-1234-bin-ubuntu-x64-cuda-13.zip"),
    asset("llama-1234-bin-ubuntu-x64-cuda-13-dlls.zip"),
    asset("llama-1234-bin-ubuntu-x64-vulkan.zip"),
    asset("llama-1234-bin-ubuntu-x64-cpu.zip"),
  ];
  const hw = { platform: "linux", arch: "x64", backend: "cuda" };
  const picked = selectAsset(hw, assets);
  assert.equal(picked.name, "llama-1234-bin-ubuntu-x64-cuda-13.zip");
});

test("Linux without GPU tool falls through to vulkan then cpu", () => {
  const assets = [
    asset("llama-1234-bin-ubuntu-x64-vulkan.zip"),
    asset("llama-1234-bin-ubuntu-x64-cpu.zip"),
  ];
  const hw = { platform: "linux", arch: "x64", backend: "vulkan" };
  const picked = selectAsset(hw, assets);
  assert.equal(picked.name, "llama-1234-bin-ubuntu-x64-vulkan.zip");
});

test("macOS arm64 picks the macos-arm64 asset", () => {
  const assets = [
    asset("llama-1234-bin-macos-arm64.zip"),
    asset("llama-1234-bin-macos-x64.zip"),
  ];
  const hw = { platform: "darwin", arch: "arm64", backend: "metal" };
  assert.equal(selectAsset(hw, assets).name, "llama-1234-bin-macos-arm64.zip");
});

test("Windows CUDA falls back to cuda-12 if cuda-13 absent", () => {
  const assets = [
    asset("llama-1234-bin-win-cuda-12.4.zip"),
    asset("llama-1234-bin-win-vulkan.zip"),
  ];
  const hw = { platform: "win32", arch: "x64", backend: "cuda" };
  assert.equal(selectAsset(hw, assets).name, "llama-1234-bin-win-cuda-12.4.zip");
});

test("No matching asset returns undefined", () => {
  const hw = { platform: "linux", arch: "x64", backend: "cuda" };
  assert.equal(selectAsset(hw, [asset("unrelated.zip")]), undefined);
});

test("assetPatterns puts arm64 first on linux-arm64", () => {
  const hw = { platform: "linux", arch: "arm64", backend: "cpu" };
  const pats = assetPatterns(hw);
  assert.ok(pats[0].test("llama-bin-linux-arm64.zip"));
});
