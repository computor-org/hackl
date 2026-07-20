import type { PromptMode } from "@hackl/core";
import { ENGINE_COMMANDS, type EngineCommand } from "./engineCli";

export interface CliArgs {
  command?: "review" | EngineCommand;
  engineArg?: string;
  allowRemote: boolean;
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
    return args;
  }
  if (positional[0] && ENGINE_COMMANDS.has(positional[0])) {
    args.command = positional[0] as EngineCommand;
    positional.shift();
    const joined = positional.join(" ").trim();
    if (joined) args.engineArg = joined;
    return args;
  }
  const joined = positional.join(" ").trim();
  if (joined) args.prompt = joined;
  return args;
}
