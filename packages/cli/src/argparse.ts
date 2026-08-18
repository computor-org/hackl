import type { PromptMode } from "@hackl/core";
export interface CliArgs {
  command?: "review" | "serve" | "models";
  engineArg?: string;
  modelsRemove?: string;
  modelsInstall?: string;
  allowRemote: boolean;
  host?: string;
  port?: number;
  token?: string;
  open: boolean;
  allowYolo: boolean;
  prompt?: string;
  mode: PromptMode;
  model?: string;
  endpoint?: string;
  apiKey?: string;
  maxToolCalls?: number;
  cwd?: string;
  json: boolean;
  yes: boolean;
  noColor: boolean;
  thinking: boolean;
  staged: boolean;
  commit?: string;
  resume: boolean;
  session?: string;
  mcpFilter?: string[];
  codex: boolean;
  help: boolean;
  version: boolean;
}

const MODES: ReadonlySet<string> = new Set(["ask", "edit", "work", "agent", "yolo"]);

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--mode",
  "--model",
  "--endpoint",
  "--api-key",
  "--cwd",
  "--commit",
  "--session",
  "--mcp",
  "--max-tool-calls",
]);

export class ArgError extends Error {}

// Parse CLI argv (excluding node + script). Throws ArgError on bad input.
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: "agent",
    allowRemote: false,
    open: false,
    allowYolo: false,
    json: false,
    yes: false,
    noColor: false,
    thinking: false,
    staged: false,
    resume: false,
    codex: false,
    help: false,
    version: false,
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("-")) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const flag = eq >= 0 ? token.slice(0, eq) : token;
    const inlineValue = eq >= 0 ? token.slice(eq + 1) : undefined;
    const takeValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined) throw new ArgError(`${flag} requires a value`);
      i += 1;
      return next;
    };

    switch (flag) {
      case "-h":
      case "--help": args.help = true; break;
      case "-v":
      case "--version": args.version = true; break;
      case "--json": args.json = true; break;
      case "-y":
      case "--yes": args.yes = true; break;
      case "--no-color": args.noColor = true; break;
      case "--thinking": args.thinking = true; break;
      case "--staged": args.staged = true; break;
      case "--resume": args.resume = true; break;
      case "--codex": args.codex = true; break;
      case "--allow-remote": args.allowRemote = true; break;
      case "--open": args.open = true; break;
      case "--no-open": args.open = false; break;
      case "--allow-yolo": args.allowYolo = true; break;
      case "--host": args.host = takeValue(); break;
      case "--port": {
        const value = Number(takeValue());
        if (!Number.isInteger(value) || value < 0 || value > 65535) {
          throw new ArgError("--port requires a number from 0 to 65535");
        }
        args.port = value;
        break;
      }
      case "--token": args.token = takeValue(); break;
      case "--mode": {
        const value = takeValue();
        if (!MODES.has(value)) throw new ArgError(`invalid --mode '${value}' (ask|edit|work|agent|yolo)`);
        args.mode = value as PromptMode;
        break;
      }
      case "--yolo": args.mode = "yolo"; break;
      case "--model": args.model = takeValue(); break;
      case "--endpoint": args.endpoint = takeValue(); break;
      case "--api-key": args.apiKey = takeValue(); break;
      case "--max-tool-calls": {
        const value = takeValue();
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) throw new ArgError(`--max-tool-calls requires a positive integer, got '${value}'`);
        args.maxToolCalls = n;
        break;
      }
      case "--cwd": args.cwd = takeValue(); break;
      case "--commit": args.commit = takeValue(); break;
      case "--session": args.session = takeValue(); break;
      case "--mcp": args.mcpFilter = [...(args.mcpFilter ?? []), takeValue()]; break;
      default:
        if (VALUE_FLAGS.has(flag)) throw new ArgError(`${flag} requires a value`);
        throw new ArgError(`unknown option: ${flag}`);
    }
  }

  if (positional[0] === "review") {
    args.command = "review";
    positional.shift();
    const joined = positional.join(" ").trim();
    if (joined) args.prompt = joined;
    rejectServeOptions(args);
    return args;
  }
  if (positional[0] === "serve") {
    args.command = "serve";
    positional.shift();
    if (positional.length > 1) throw new ArgError("usage: hackl serve [model]");
    args.engineArg = positional[0];
    return args;
  }
  if (positional[0] === "models") {
    args.command = "models";
    const modelArgs = positional.slice(1);
    if (modelArgs.length === 0) {
      rejectServeOptions(args);
      return args;
    }
    if (modelArgs.length !== 2 || !["remove", "install"].includes(modelArgs[0])) {
      throw new ArgError("usage: hackl models [install|remove <model>]");
    }
    if (modelArgs[0] === "install") args.modelsInstall = modelArgs[1];
    else args.modelsRemove = modelArgs[1];
    rejectServeOptions(args);
    return args;
  }
  const joined = positional.join(" ").trim();
  if (joined) args.prompt = joined;
  rejectServeOptions(args);
  return args;
}

function rejectServeOptions(args: CliArgs): void {
  if (args.allowRemote || args.open || args.allowYolo || args.host || args.port !== undefined || args.token) {
    throw new ArgError("--open, --host, --port, --token, --allow-yolo, and --allow-remote require `hackl serve`");
  }
}
