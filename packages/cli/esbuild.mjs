import esbuild from "esbuild";

// Bundle the CLI into a single self-contained file with a shebang. @hackl/core
// is resolved from source (the "source" export condition) so esbuild inlines
// the whole backend AND the ESM-only MCP SDK; the result needs no node_modules.
await esbuild.build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  conditions: ["source"],
  logLevel: "info",
});
