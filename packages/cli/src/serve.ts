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

export async function runServeCommand(args: CliArgs): Promise<number> {
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
    host = new EngineSessionHost({ mode: "foreground", allowRemote: args.allowRemote });
    if (!await host.listen(args.engineArg, options.log)) {
      host = undefined;
      lease = await EngineSessionLease.acquire(options);
    }
  }

  const status = lease?.status ?? await host!.status();
  const endpoint = requireEndpoint(status);
  let server: HacklServer | undefined;
  try {
    server = await createBrowserServer(args, status, endpoint);
    process.stdout.write(`Hackl WebUI: ${server.url}\n`);
    process.stdout.write(`llama.cpp WebUI: ${endpoint.replace(/\/v1\/?$/, "")}\n`);
    process.stdout.write(`model: ${status.alias ?? status.model ?? "external"} · owner: ${status.owner ?? "external"}\n`);
    process.stdout.write("Press Ctrl+C to stop.\n");
    if (args.open) openBrowser(server.url);
    await waitForSignal();
    return 0;
  } finally {
    await server?.close();
    await lease?.release();
    await host?.close();
  }
}

async function createBrowserServer(
  args: CliArgs,
  status: EngineSessionStatus,
  endpoint: string,
): Promise<HacklServer> {
  const agent = await createServerAgent({
    ...process.env,
    HACKL_ENDPOINT: endpoint,
    HACKL_MODEL: status.model,
  });
  return createHacklServer({
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
}

function requireEndpoint(status: EngineSessionStatus): string {
  if (!status.endpoint) throw new Error("local engine started without an endpoint");
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
