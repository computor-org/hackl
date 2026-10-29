import * as path from "node:path";
import { spawn } from "node:child_process";
import {
  EngineSessionHost,
  EngineSessionLease,
  type EngineSessionStatus,
} from "@hackl/core";
import { createHacklServer, createServerAgent, type HacklServer } from "@hackl/server";
import WEBUI_ASSETS from "hackl-webui-assets";
import type { CliArgs } from "./argparse";

// Downloading llama.cpp or a model is consent the user gives to `hackl models
// install` or to the VS Code engine panel, never to `hackl serve` (issue #36).
const NO_ENGINE_HINT = "hackl serve downloads nothing. Point it at a running server with\n"
  + "  HACKL_ENDPOINT=http://host:port/v1 hackl serve\n"
  + "or download a managed model first with `hackl models install <model>`.";

export async function runServeCommand(args: CliArgs, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  // A configured endpoint is a server to serve against, so the managed engine is
  // neither acquired nor started.
  const endpoint = args.endpoint?.trim() || env.HACKL_ENDPOINT?.trim();
  if (endpoint) return serveEndpoint(args, env, endpoint);
  return serveManagedEngine(args, env);
}

async function serveEndpoint(args: CliArgs, env: NodeJS.ProcessEnv, endpoint: string): Promise<number> {
  const model = args.model?.trim() || env.HACKL_MODEL?.trim() || args.engineArg?.trim() || "";
  const apiKey = args.apiKey?.trim() || env.HACKL_API_KEY?.trim() || "";
  return serveWebUi(args, env, { HACKL_ENDPOINT: endpoint, HACKL_MODEL: model, HACKL_API_KEY: apiKey });
}

async function serveManagedEngine(args: CliArgs, env: NodeJS.ProcessEnv): Promise<number> {
  const options = {
    kind: "serve" as const,
    alias: args.engineArg,
    log: (text: string): void => { process.stdout.write(`${text}\n`); },
  };
  let lease = await EngineSessionLease.acquireExisting(options);
  let host: EngineSessionHost | undefined;
  if (lease && args.allowRemote) {
    await lease.release();
    throw new Error("--allow-remote cannot change an engine already owned by another client");
  }
  if (!lease) {
    host = new EngineSessionHost({
      mode: "foreground",
      allowRemote: args.allowRemote,
      allowDownload: false,
    });
    try {
      if (!await host.listen(args.engineArg, options.log)) {
        host = undefined;
        lease = await EngineSessionLease.acquire(options);
      }
    } catch (error) {
      throw new Error(`${(error as Error).message}\n${NO_ENGINE_HINT}`);
    }
  }

  const status = lease?.status ?? await host!.status();
  const endpoint = requireEndpoint(status);
  try {
    return await serveWebUi(args, env, { HACKL_ENDPOINT: endpoint, HACKL_MODEL: status.model ?? "" }, status);
  } finally {
    await lease?.release();
    await host?.close();
  }
}

async function serveWebUi(
  args: CliArgs,
  env: NodeJS.ProcessEnv,
  overrides: Record<string, string>,
  status?: EngineSessionStatus,
): Promise<number> {
  const agent = await createServerAgent({ ...env, ...overrides });
  let server: HacklServer | undefined;
  try {
    server = await createHacklServer({
      cwd: path.resolve(args.cwd ?? process.cwd()),
      host: args.host,
      port: args.port,
      token: args.token,
      allowYolo: args.allowYolo,
      staticAssets: WEBUI_ASSETS,
      backend: agent.backend,
      sessionConfig: agent.sessionConfig,
      endpoint: agent.endpoint,
      model: agent.model,
    });
    process.stdout.write(`Hackl WebUI: ${server.url}\n`);
    process.stdout.write(`endpoint: ${agent.endpoint}\n`);
    const owner = status ? ` · owner: ${status.owner ?? "external"}` : "";
    process.stdout.write(`model: ${agent.model}${owner}\n`);
    process.stdout.write("Press Ctrl+C to stop.\n");
    if (args.open) openBrowser(server.url);
    await waitForSignal();
    return 0;
  } finally {
    await server?.close();
  }
}

function requireEndpoint(status: EngineSessionStatus): string {
  if (!status.endpoint) throw new Error(`local engine started without an endpoint\n${NO_ENGINE_HINT}`);
  return status.endpoint;
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const commandArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, commandArgs, { stdio: "ignore", detached: true, windowsHide: true }).unref();
  } catch { /* best effort */ }
}
