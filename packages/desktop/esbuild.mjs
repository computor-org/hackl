import esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";

// Bundle the Electron main process into one CJS file. electron is external
// (provided by the runtime); @hackl/server and its deps resolve from source and
// are inlined, so the packaged app needs no node_modules. The shared web UI dist
// is copied next to it and served by the embedded server.
rmSync("build", { recursive: true, force: true });
mkdirSync("build", { recursive: true });

await esbuild.build({
  entryPoints: ["src/main.ts"],
  outfile: "build/main.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  conditions: ["source"],
  logLevel: "info",
});

await esbuild.build({
  entryPoints: ["../vscode/src/engineHost.ts"],
  outfile: "build/engine-host.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  conditions: ["source"],
  logLevel: "info",
});

const webuiDist = "../webui/dist";
if (!existsSync(webuiDist)) {
  throw new Error("Build @hackl/webui first: npm run build -w @hackl/webui");
}
cpSync(webuiDist, "build/webui", { recursive: true });
