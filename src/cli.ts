#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout, stderr as defaultStderr } from "node:process";
import type { ChatMessage } from "./chatClient";
import { createOpenAICompatibleBackend } from "./chatClient";
import { ApprovalRequester, ChatAnswer, PromptProgress } from "./chatSession";
import { buildPromptContext, ContextDocument } from "./context";
import { detectMaxContextTokens, resolveChatTarget } from "./localServers";
import { buildHacklMessages, ConversationMessage, PromptMode } from "./prompt";
import { completeWithTools } from "./toolLoop";
import { estimateChatTokens, formatTokenBudget } from "./tokenBudget";
import { createNodeWorkspaceHost, createWorkspaceToolRunner } from "./workspaceTools";

interface CliConfig {
  promptArgs: string[];
  mode: PromptMode;
  cwd: string;
  endpoint: string;
  endpointConfigured: boolean;
  maxToolFileChars: number;
  maxContextTokens?: number;
  enableThinking: boolean;
  files: string[];
  help: boolean;
}

interface CliIo {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

export async function main(argv = process.argv.slice(2), io: CliIo = {
  stdin: defaultStdin,
  stdout: defaultStdout,
  stderr: defaultStderr,
}): Promise<number> {
  const config = parseArgs(argv, process.env);
  if (config.help) {
    io.stdout.write(usage());
    return 0;
  }

  const stdinPrompt = await readStdin(io.stdin);
  const prompt = [...config.promptArgs, stdinPrompt].filter((part) => part.trim()).join("\n\n").trim();
  if (!prompt) {
    io.stderr.write("hackl: prompt required on argv or stdin\n");
    return 2;
  }

  try {
    const streamed = { answer: false };
    const answer = await answerPrompt(prompt, [], config, (event) => {
      if (event.type === "delta" && event.channel === "answer") {
        streamed.answer = true;
        io.stdout.write(event.text);
      } else if (event.type === "phase") {
        io.stderr.write(`${event.text}\n`);
      }
    }, (request) => requestCliApproval(request, config, io));

    if (!streamed.answer) {
      io.stdout.write(answer.content);
    }
    if (!answer.content.endsWith("\n")) {
      io.stdout.write("\n");
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`hackl: ${message}\n`);
    return 1;
  }
}

async function answerPrompt(
  prompt: string,
  history: ConversationMessage[],
  config: CliConfig,
  progress: (event: PromptProgress) => void,
  requestApproval: ApprovalRequester,
): Promise<ChatAnswer> {
  progress({ type: "phase", text: "Preprocessing prompt..." });
  const target = await resolveChatTarget({
    endpoint: config.endpoint,
    endpointConfigured: config.endpointConfigured,
  });
  const maxContextTokens = config.maxContextTokens
    ?? await detectMaxContextTokens(target.endpoint).catch(() => undefined)
    ?? 32768;
  const contextText = buildPromptContext(collectCliContext(config), {
    maxToolFileChars: config.maxToolFileChars,
  });
  const messages: ChatMessage[] = buildHacklMessages(prompt, contextText, history, config.mode);
  const inputTokens = estimateChatTokens(messages);
  progress({
    type: "phase",
    text: `Preprocessing done · ${formatTokenBudget(inputTokens, maxContextTokens)}`,
    inputTokens,
    maxContextTokens,
  });
  progress({ type: "phase", text: "Model request..." });

  return completeWithTools({
    backend: createOpenAICompatibleBackend({ ...target, enableThinking: config.enableThinking }),
    messages,
    runTool: createWorkspaceToolRunner({
      maxFileChars: config.maxToolFileChars,
      allowEdits: canEdit(config.mode),
      allowSearch: canWork(config.mode),
      allowCommands: config.mode === "agent" || config.mode === "yolo",
      commandApproval: config.mode === "yolo" ? "auto" : "ask",
      requestApproval,
      workspace: createNodeWorkspaceHost(config.cwd),
    }),
    maxToolCalls: toolCallLimit(config.mode),
    progress,
  });
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): CliConfig {
  const config: CliConfig = {
    promptArgs: [],
    mode: parseMode(env.HACKL_MODE),
    cwd: path.resolve(env.HACKL_CWD || process.cwd()),
    endpoint: env.HACKL_ENDPOINT || "",
    endpointConfigured: Boolean(env.HACKL_ENDPOINT?.trim()),
    maxToolFileChars: parsePositiveInt(env.HACKL_MAX_TOOL_FILE_CHARS) ?? 12000,
    maxContextTokens: parsePositiveInt(env.HACKL_MAX_CONTEXT_TOKENS),
    enableThinking: env.HACKL_ENABLE_THINKING === "1" || env.HACKL_ENABLE_THINKING === "true",
    files: [],
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      config.help = true;
    } else if (arg === "--mode") {
      config.mode = parseMode(takeValue(argv, ++index, arg));
    } else if (arg.startsWith("--mode=")) {
      config.mode = parseMode(arg.slice("--mode=".length));
    } else if (arg === "--endpoint") {
      config.endpoint = takeValue(argv, ++index, arg);
      config.endpointConfigured = true;
    } else if (arg.startsWith("--endpoint=")) {
      config.endpoint = arg.slice("--endpoint=".length);
      config.endpointConfigured = true;
    } else if (arg === "--cwd") {
      config.cwd = path.resolve(takeValue(argv, ++index, arg));
    } else if (arg.startsWith("--cwd=")) {
      config.cwd = path.resolve(arg.slice("--cwd=".length));
    } else if (arg === "--file") {
      config.files.push(takeValue(argv, ++index, arg));
    } else if (arg.startsWith("--file=")) {
      config.files.push(arg.slice("--file=".length));
    } else if (arg === "--max-tool-file-chars") {
      config.maxToolFileChars = parsePositiveInt(takeValue(argv, ++index, arg)) ?? config.maxToolFileChars;
    } else if (arg === "--max-context-tokens") {
      config.maxContextTokens = parsePositiveInt(takeValue(argv, ++index, arg));
    } else if (arg === "--enable-thinking") {
      config.enableThinking = true;
    } else {
      config.promptArgs.push(arg);
    }
  }
  return config;
}

function collectCliContext(config: CliConfig): ContextDocument[] {
  return config.files.map((value, index) => {
    const parsed = parseFileArg(value, config.cwd);
    return {
      fileName: parsed.fileName,
      path: path.relative(config.cwd, parsed.fileName) || parsed.fileName,
      languageId: languageId(parsed.fileName),
      isActive: index === 0,
      cursorLine: parsed.line,
      cursorCharacter: parsed.line === undefined ? undefined : 1,
    };
  });
}

function parseFileArg(value: string, cwd: string): { fileName: string; line?: number } {
  const match = value.match(/^(.*):(\d+)$/);
  const rawPath = match ? match[1] : value;
  return {
    fileName: path.resolve(cwd, rawPath),
    line: match ? Number(match[2]) : undefined,
  };
}

function languageId(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const known: Record<string, string> = {
    ".cjs": "javascript",
    ".js": "javascript",
    ".mjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".jsx": "javascriptreact",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".f90": "fortran",
    ".md": "markdown",
    ".json": "json",
  };
  return known[ext] ?? ext.replace(/^\./, "") ?? "plaintext";
}

async function requestCliApproval(
  request: Parameters<ApprovalRequester>[0],
  config: CliConfig,
  io: CliIo,
): Promise<boolean> {
  if (config.mode === "yolo" && request.title !== "Workspace is not a Git repository") {
    return true;
  }
  if (!io.stdin.isTTY || !io.stderr.isTTY) {
    return false;
  }
  io.stderr.write(`${request.title}\n${request.detail}\n`);
  const rl = readline.createInterface({ input: io.stdin, output: io.stderr });
  try {
    const answer = await rl.question(`${request.approveLabel}? [y/N] `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

function canEdit(mode: PromptMode): boolean {
  return mode === "edit" || mode === "work" || mode === "agent" || mode === "yolo";
}

function canWork(mode: PromptMode): boolean {
  return mode === "work" || mode === "agent" || mode === "yolo";
}

function toolCallLimit(mode: PromptMode): number {
  if (mode === "agent" || mode === "yolo") return 48;
  if (mode === "work") return 24;
  if (mode === "edit") return 12;
  return 4;
}

function parseMode(value: string | undefined): PromptMode {
  return value === "edit" || value === "work" || value === "agent" || value === "yolo" ? value : "ask";
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function readStdin(stdin: NodeJS.ReadStream): Promise<string> {
  if (stdin.isTTY) {
    return "";
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stdin.on("error", reject);
    stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stdin.resume();
  });
}

function usage(): string {
  return [
    "Usage: hackl [--mode ask|edit|work|agent|yolo] [--file path[:line]] [prompt...]",
    "",
    "Reads additional prompt text from stdin and writes the final answer to stdout.",
    "Environment: HACKL_ENDPOINT, HACKL_MODE, HACKL_CWD, HACKL_MAX_TOOL_FILE_CHARS.",
    "",
  ].join("\n");
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
