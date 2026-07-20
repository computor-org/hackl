import * as path from "node:path";
import { spawn } from "node:child_process";
import { createHacklServer } from "./server";
import { createServerAgent } from "./agent";
import { resolveWebuiDir } from "./webuiDir";

interface ServeArgs {
  cwd: string;
  host?: string;
  port?: number;
  token?: string;
  allowYolo: boolean;
  open: boolean;
  help: boolean;
}

const HELP = `hackl-serve - run the hackl GUI on a localhost server

Usage:
  hackl-serve [options]

Options:
  --cwd <dir>        workspace root (default: current directory)
  --host <host>      bind address (default: 127.0.0.1, loopback only)
  --port <n>         port (default: 0 = OS-assigned)
  --allow-yolo       allow yolo mode (runs any command with no approval)
  --open             open the URL in the default browser
  --token <token>    use a fixed auth token instead of a random one
  -h, --help         show this help

Backend config comes from HACKL_ENDPOINT / HACKL_API_KEY / HACKL_MODEL (same as
the CLI). The server binds loopback only and requires the printed token.
`;

function parseArgs(argv: string[]): ServeArgs {
  const args: ServeArgs = { cwd: process.cwd(), allowYolo: false, open: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const value = (): string => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${token} requires a value`);
      return next;
    };
    switch (token) {
      case "-h":
      case "--help": args.help = true; break;
      case "--cwd": args.cwd = path.resolve(value()); break;
      case "--host": args.host = value(); break;
      case "--port": args.port = Number(value()); break;
      case "--token": args.token = value(); break;
      case "--allow-yolo": args.allowYolo = true; break;
      case "--open": args.open = true; break;
      case "--no-open": args.open = false; break;
      default: throw new Error(`unknown option: ${token}`);
    }
  }
  return args;
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const commandArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, commandArgs, { stdio: "ignore", detached: true }).unref();
  } catch {
    // best effort
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  const agent = await createServerAgent();
  const webuiDir = resolveWebuiDir();
  const server = await createHacklServer({
    cwd: args.cwd,
    host: args.host,
    port: args.port,
    token: args.token,
    allowYolo: args.allowYolo,
    staticDir: webuiDir,
    backend: agent.backend,
    sessionConfig: agent.sessionConfig,
    endpoint: agent.endpoint,
    model: agent.model,
  });

  process.stdout.write(`hackl serve: ${server.url}\n`);
  process.stdout.write(`workspace: ${args.cwd}\n`);
  process.stdout.write(`model: ${agent.model}  endpoint: ${agent.endpoint}\n`);
  if (args.allowYolo) {
    process.stdout.write("WARNING: --allow-yolo is set. Yolo runs any command with no policy and no approval. You are responsible for what happens.\n");
  }
  if (!webuiDir) {
    process.stdout.write("note: web UI bundle not found. Build @hackl/webui, then restart, to serve the browser UI.\n");
  }
  if (args.open) openBrowser(server.url);

  const shutdown = (): void => {
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  process.stderr.write(`hackl-serve: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
