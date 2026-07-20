import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as readline from "node:readline";
import type { ConversationMessage, PromptMode } from "@hackl/core";
import { EngineManager } from "@hackl/core";
import { parseArgs, ArgError, CliArgs } from "./argparse";
import { loadCliConfig } from "./config";
import { createApprover } from "./approval";
import { createAgentContext, runTurn, AgentContext } from "./agent";
import { Renderer, statusLine } from "./render";
import { ENGINE_COMMANDS, runEngineCommand, handleEngineSlash, type EngineCommand } from "./engineCli";

const VERSION = "0.2.0";

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ArgError) {
      process.stderr.write(`hackl: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  // Engine subcommands (hackl up/down/status/restart/pull/model/doctor) manage
  // the local llama.cpp server and need no chat backend.
  if (args.command && ENGINE_COMMANDS.has(args.command)) {
    process.exit(await runEngineCommand(args.command as EngineCommand, { arg: args.engineArg, allowRemote: args.allowRemote }));
  }

  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const config = loadCliConfig({ args, cwd });

  const piped = !process.stdin.isTTY;
  const stdinPrompt = piped && !args.prompt ? (await readStdin()).trim() : "";
  const oneShotPrompt = args.prompt ?? (stdinPrompt || undefined);
  const interactive = !oneShotPrompt && !args.json && process.stdin.isTTY && args.command !== "review";

  const color = !args.noColor && Boolean(process.stdout.isTTY) && !args.json;
  const rl = interactive || (process.stdin.isTTY && !args.json)
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : undefined;

  const approver = createApprover({
    autoApprove: args.yes,
    ask: rl ? (question) => new Promise<string>((resolve) => rl.question(question, resolve)) : undefined,
  });

  let ctx: AgentContext;
  try {
    ctx = await createAgentContext({ config, args, cwd, requestApproval: approver });
  } catch (error) {
    process.stderr.write(`hackl: ${(error as Error).message}\n`);
    rl?.close();
    process.exit(1);
    return;
  }

  try {
    if (interactive && rl) {
      await runRepl(ctx, rl, args, color);
    } else {
      await runOneShot(ctx, args, color, reviewOrPrompt(args, oneShotPrompt));
    }
  } finally {
    await ctx.mcp?.close();
    rl?.close();
  }
}

function reviewOrPrompt(args: CliArgs, oneShotPrompt: string | undefined): string {
  if (args.command === "review") {
    return oneShotPrompt
      ? `Review the changes. ${oneShotPrompt}`
      : "Review the changes for bugs, regressions, and risky edits. Anchor each finding to a file and line.";
  }
  return oneShotPrompt ?? "";
}

async function runOneShot(ctx: AgentContext, args: CliArgs, color: boolean, prompt: string): Promise<void> {
  if (!prompt) {
    process.stderr.write("hackl: no prompt. Pass a prompt, pipe stdin, or run interactively.\n");
    process.exit(2);
  }
  const renderer = new Renderer({ json: args.json, color, thinking: args.thinking });
  const review = args.command === "review";
  if (args.mode === "yolo" && !review && !args.json) process.stderr.write(yoloWarning());
  await runTurn(ctx, {
    prompt,
    mode: review ? "work" : args.mode,
    history: [],
    renderer,
    staged: args.staged,
    commit: args.commit,
    createAnnotations: review,
  });
}

async function runRepl(ctx: AgentContext, rl: readline.Interface, args: CliArgs, color: boolean): Promise<void> {
  let mode: PromptMode = args.mode;
  const history: ConversationMessage[] = [];
  process.stdout.write(`${statusLine(mode, ctx.model, color)}  endpoint ${ctx.endpoint}\n`);
  process.stdout.write("Type a prompt, or /help. Ctrl+D to exit.\n");
  if (mode === "yolo") process.stdout.write(yoloWarning());

  const ask = (): Promise<string> => new Promise((resolve) => rl.question("> ", resolve));
  const engine = new EngineManager();

  for (;;) {
    const line = (await ask()).trim();
    if (line === "") continue;
    if (line.startsWith("/")) {
      if (await handleEngineSlash(line, engine)) continue;
      const done = handleSlash(line, ctx, color, { get: () => mode, set: (m) => { mode = m; }, history });
      if (done === "quit") break;
      continue;
    }
    const renderer = new Renderer({ json: false, color, thinking: args.thinking });
    history.push({ role: "user", content: line });
    try {
      const answer = await runTurn(ctx, { prompt: line, mode, history: history.slice(0, -1), renderer, staged: args.staged });
      history.push({ role: "assistant", content: answer });
    } catch (error) {
      process.stderr.write(`error: ${(error as Error).message}\n`);
    }
  }
}

function handleSlash(
  line: string,
  ctx: AgentContext,
  color: boolean,
  state: { get: () => PromptMode; set: (m: PromptMode) => void; history: ConversationMessage[] },
): "quit" | "ok" {
  const [cmd, ...rest] = line.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  switch (cmd) {
    case "quit":
    case "exit":
      return "quit";
    case "help":
      process.stdout.write(REPL_HELP);
      return "ok";
    case "clear":
      state.history.length = 0;
      process.stdout.write("context cleared\n");
      return "ok";
    case "mode":
      if (["ask", "edit", "work", "agent", "yolo"].includes(arg)) {
        state.set(arg as PromptMode);
        process.stdout.write(`mode: ${arg}\n`);
        if (arg === "yolo") process.stdout.write(yoloWarning());
      } else {
        process.stdout.write(`mode: ${state.get()} (use /mode ask|edit|work|agent|yolo)\n`);
      }
      return "ok";
    case "model":
      process.stdout.write(`model: ${ctx.model} (change with --model and restart)\n`);
      return "ok";
    case "mcp": {
      const status = ctx.mcp?.status() ?? [];
      if (!status.length) {
        process.stdout.write("mcp: no servers configured\n");
      } else {
        for (const server of status) {
          const detail = server.state === "failed" ? ` (${server.error ?? "error"})` : ` ${server.toolCount} tools`;
          process.stdout.write(`mcp: ${server.name} [${server.state}]${detail}\n`);
        }
      }
      return "ok";
    }
    default:
      process.stdout.write(`unknown command: /${cmd}\n`);
      return "ok";
  }
}

function yoloWarning(): string {
  return "WARNING: yolo mode is active. Hackl will run any command with no policy "
    + "and no approval prompts. You are responsible for what happens. Use a clean "
    + "branch or a sandbox.\n";
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
  });
}

const HELP = `hackl - local-first AI coding agent

Usage:
  hackl [options] [prompt]        one-shot prompt (or pipe stdin)
  hackl [options]                 interactive REPL (in a terminal)
  hackl review [options] [note]   review staged/commit changes

Local engine (managed llama.cpp, loopback-only):
  hackl doctor                    probe hardware + recommend a model
  hackl up [model]                start the engine (fetches llama.cpp + model)
  hackl down                      stop the managed engine
  hackl status                    engine status (managed / adopted external)
  hackl restart [model]           restart the managed engine
  hackl pull <model>              download a catalog model
  hackl model [alias]             show or switch the default model
  --allow-remote                  bind 0.0.0.0 (DANGER: reachable beyond localhost)

Options:
  --mode ask|edit|work|agent|yolo  tool permissions (default: agent)
  --yolo                       DANGER: no command policy, no approval prompts.
                               Runs any shell command. You are responsible for
                               whatever happens. Same as --mode yolo.
  --model <id>                 model id (default: endpoint's model)
  --endpoint <url>             OpenAI-compatible base URL (default: auto-detect)
  --api-key <key>              Bearer token for the endpoint (e.g. OpenRouter).
                               Prefer HACKL_API_KEY to keep it out of shell history.
  --max-tool-calls <n>         tool-call budget per turn (default: 128)
  --cwd <dir>                  workspace root (default: current directory)
  --staged                     include staged git changes as context
  --commit <sha>               include a commit's diff as context
  --mcp <name>                 only connect the named MCP server (repeatable)
  --codex                      use the Codex backend
  --thinking                   show model reasoning
  --json                       emit NDJSON events (for scripting)
  -y, --yes                    auto-approve gated actions (non-interactive)
  --no-color                   disable ANSI colors
  -h, --help                   show this help
  -v, --version                show version

Context: mention files in the prompt with @path or @path:start-end.
Config:  ~/.config/hackl/config.json, ./.hackl/config.json, HACKL_* env, flags.
`;

const REPL_HELP = `commands:
  /mode ask|edit|work|agent|yolo  change tool permissions (yolo runs any command)
  /doctor                     probe hardware + recommend a model
  /up [model]  /down  /restart    manage the local llama.cpp engine
  /engine  (/status)          engine status
  /models  (/ls)              catalog (present/missing + size)
  /pull <model>               download a model
  /model [alias]              show or switch the local model
  /set [key value]            show or change engine config (ctx, ngl, n-cpu-moe, kv, mtp, mmproj, host, ...)
  /reset                      reset engine knobs to hardware defaults
  /mcp                        show MCP server status
  /clear                      clear conversation context
  /help                       this help
  /quit                       exit
mention files with @path or @path:start-end.
`;

main().catch((error) => {
  process.stderr.write(`hackl: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
