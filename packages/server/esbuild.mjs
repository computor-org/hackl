import esbuild from "esbuild";

// Bundle the hackl-serve entry into one self-contained CJS file with a shebang.
// @hackl/core and @hackl/protocol resolve from source (the "source" export
// condition) so esbuild inlines the backend, the protocol, and the ESM-only MCP
// SDK; ws is bundled too. The result needs no node_modules at runtime.
await esbuild.build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  conditions: ["source"],
  logLevel: "info",
});
