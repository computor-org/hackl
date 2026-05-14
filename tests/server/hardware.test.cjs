const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseNvidiaSmi,
  parseRocmSmi,
  parseWinGpu,
  parseAppleGpuName,
} = require("../../dist/server/hardware.js");

test("parseNvidiaSmi parses a single GPU line", () => {
  const out = "NVIDIA GeForce RTX 5060 Ti, 16384, 15800\n";
  const parsed = parseNvidiaSmi(out);
  assert.equal(parsed.gpuName, "NVIDIA GeForce RTX 5060 Ti");
  assert.equal(parsed.vramTotalBytes, 16384 * 1024 * 1024);
  assert.equal(parsed.vramFreeBytes, 15800 * 1024 * 1024);
});

test("parseNvidiaSmi returns undefined for empty output", () => {
  assert.equal(parseNvidiaSmi(""), undefined);
});

test("parseRocmSmi extracts the first card with VRAM totals", () => {
  const out = JSON.stringify({
    "card0": {
      "Card series": "Radeon RX 7900 XT",
      "VRAM Total Memory (B)": 21474836480,
      "VRAM Total Used Memory (B)": 1073741824,
    },
  });
  const parsed = parseRocmSmi(out);
  assert.equal(parsed.gpuName, "Radeon RX 7900 XT");
  assert.equal(parsed.vramTotalBytes, 21474836480);
  assert.equal(parsed.vramFreeBytes, 21474836480 - 1073741824);
});

test("parseWinGpu picks the largest AdapterRAM", () => {
  const out = JSON.stringify([
    { Name: "Intel UHD Graphics", AdapterRAM: 1073741824 },
    { Name: "NVIDIA GeForce RTX 4090", AdapterRAM: 24 * 1024 * 1024 * 1024 },
  ]);
  const parsed = parseWinGpu(out);
  assert.equal(parsed.gpuVendor, "nvidia");
  assert.equal(parsed.gpuName, "NVIDIA GeForce RTX 4090");
  assert.equal(parsed.vramTotalBytes, 24 * 1024 * 1024 * 1024);
});

test("parseAppleGpuName extracts sppci_model from system_profiler json", () => {
  const out = JSON.stringify({
    SPDisplaysDataType: [
      { sppci_model: "Apple M3 Max", _name: "kHW_AppleM3Item" },
    ],
  });
  assert.equal(parseAppleGpuName(out), "Apple M3 Max");
});

test("parsers reject malformed input gracefully", () => {
  assert.equal(parseRocmSmi("{not json"), undefined);
  assert.equal(parseWinGpu(""), undefined);
  assert.equal(parseAppleGpuName(""), undefined);
});
