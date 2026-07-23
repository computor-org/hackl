import esbuild from "esbuild";

// Bundle the extension into a single self-contained dist/extension.js. @hackl/core
// is resolved from source (the "source" export condition) so esbuild inlines the
// backend AND the ESM-only MCP SDK; the VSIX needs no runtime dependencies.
// `vscode` is provided by the host.
await esbuild.build({
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  conditions: ["source"],
  logLevel: "info",
});

await esbuild.build({
  entryPoints: ["src/engineHost.ts"],
  outfile: "dist/engine-host.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  conditions: ["source"],
  logLevel: "info",
});
