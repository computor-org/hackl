import type { ChatBackend, ChatDelta, ChatMessage } from "./chatClient";
import { splitReasoning } from "./reasoning";
import {
  buildToolResultMessage,
  parseToolRequest,
  ToolRequest,
  ToolResult,
} from "./tools";
import type { DebugLog } from "./debugLog";

export type ToolRunner = (request: ToolRequest) => Promise<ToolResult>;

export type PromptProgress =
  | { type: "phase"; text: string; inputTokens?: number; maxContextTokens?: number }
  | { type: "delta"; channel: "answer" | "reasoning"; text: string };

export interface ToolLoopOptions {
  backend: ChatBackend;
  messages: ChatMessage[];
  runTool: ToolRunner;
  maxToolCalls: number;
  progress?: (event: PromptProgress) => void;
  debug?: DebugLog;
  signal?: AbortSignal;
}

export interface ToolLoopAnswer {
  content: string;
  reasoning?: string;
}

export async function completeWithTools(options: ToolLoopOptions): Promise<ToolLoopAnswer> {
  const messages = [...options.messages];
  const toolHistory: ToolInteraction[] = [];
  const requestCounts = new Map<string, number>();
  options.debug?.("toolLoop.start", { messages: messages.length, maxToolCalls: options.maxToolCalls });

  for (let toolCalls = 0; toolCalls <= options.maxToolCalls; toolCalls++) {
    if (options.signal?.aborted) {
      throw new DOMException("Cancelled", "AbortError");
    }
    const router = new DeltaRouter(options.progress);
    const completion = await completeUntilToolRequest(options, router, messages);

    const content = completion.content;
    options.debug?.("toolLoop.completion", { toolCalls, content, reasoning: completion.reasoning });
    const request = parseToolRequest(content);
    if (!request) {
      router.flushAnswer();
      const split = splitReasoning(content);
      const text = split.answer || content;
      const answer = {
        content: finalContent(text, toolHistory),
        reasoning: completion.reasoning || split.reasoning || undefined,
      };
      options.debug?.("toolLoop.final", answer);
      return answer;
    }

    options.debug?.("toolLoop.toolRequest", { toolCalls, request });
    messages.push({ role: "assistant", content });
    const signature = toolSignature(request);
    const repeated = (requestCounts.get(signature) ?? 0) + 1;
    requestCounts.set(signature, repeated);
    if (repeated > 2) {
      options.debug?.("toolLoop.repeatedToolRequest", { toolCalls, request, repeated });
      break;
    }
    if (toolCalls === options.maxToolCalls) {
      options.debug?.("toolLoop.toolLimit", { toolCalls, request });
      break;
    }

    options.progress?.({ type: "phase", text: `Running tool: ${formatToolRequest(request)}` });
    const result = await options.runTool(request);
    toolHistory.push({ request, result });
    options.debug?.("toolLoop.toolResult", { toolCalls, request, result });
    messages.push({ role: "user", content: buildToolResultMessage(request, result) });
  }

  return forceFinalAnswer(messages, toolHistory, options);
}

interface ToolInteraction {
  request: ToolRequest;
  result: ToolResult;
}

function formatToolRequest(request: ToolRequest): string {
  if ("path" in request) {
    return `${request.name} ${request.path}`;
  }
  if (request.name === "run_command") {
    return `${request.name} ${[request.cmd, ...(request.args ?? [])].join(" ")}`;
  }
  return `${request.name} ${request.query}`;
}

async function forceFinalAnswer(
  messages: ChatMessage[],
  toolHistory: ToolInteraction[],
  options: ToolLoopOptions,
): Promise<ToolLoopAnswer> {
  if (options.signal?.aborted) {
    throw new DOMException("Cancelled", "AbortError");
  }
  const nudged: ChatMessage[] = [
    ...messages,
    {
      role: "user",
      content: "Stop. Answer now in plain text. Do not output HACKL_TOOL.",
    },
  ];
  options.progress?.({ type: "phase", text: "Forcing final answer..." });
  const router = new DeltaRouter(options.progress);
  const completion = await completeUntilToolRequest(options, router, nudged);
  options.debug?.("toolLoop.forceCompletion", { content: completion.content, reasoning: completion.reasoning });

  const cleaned = stripToolCalls(completion.content);
  const split = splitReasoning(cleaned);
  const answer = split.answer || cleaned;
  const finalAnswer = {
    content: finalContent(answer, toolHistory),
    reasoning: completion.reasoning || split.reasoning || undefined,
  };
  options.debug?.("toolLoop.forceFinal", { cleaned, answer: finalAnswer });
  return finalAnswer;
}

function finalContent(answer: string, toolHistory: ToolInteraction[]): string {
  const trimmed = answer.trim();
  if (trimmed) {
    return trimmed;
  }
  const last = toolHistory.at(-1);
  if (!last) {
    return "I did not receive usable assistant text from the model.";
  }
  if (!last.result.ok) {
    return `I could not complete the request: ${last.result.content}`;
  }
  return `I ran ${formatToolRequest(last.request)}, but the model did not provide a final answer. Last tool result:\n${last.result.content}`;
}

function stripToolCalls(content: string): string {
  return content.replace(/HACKL_TOOL\s*\{[\s\S]*?\}/g, "").trim();
}

function toolSignature(request: ToolRequest): string {
  return JSON.stringify(request);
}

async function completeUntilToolRequest(
  options: ToolLoopOptions,
  router: DeltaRouter,
  messages: ChatMessage[],
): Promise<{ content: string; reasoning?: string }> {
  try {
    return await options.backend.complete(messages, {
      onDelta: (delta) => {
        router.handle(delta);
        const request = parseToolRequest(router.answer);
        if (request) {
          throw new EarlyToolRequest(router.answer);
        }
      },
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof EarlyToolRequest) {
      return { content: error.content };
    }
    throw error;
  }
}

class EarlyToolRequest extends Error {
  constructor(readonly content: string) {
    super("Tool request detected.");
  }
}

class DeltaRouter {
  private answerBuffer = "";
  private reasoningBuffer = "";
  private forwardedAnswer = 0;
  private forwardedReasoning = 0;

  constructor(private readonly progress: ((event: PromptProgress) => void) | undefined) {}

  get answer(): string {
    return this.answerBuffer;
  }

  handle(delta: ChatDelta): void {
    if (delta.type === "reasoning") {
      this.reasoningBuffer += delta.text;
      this.forwardReasoning();
      return;
    }

    this.answerBuffer += delta.text;
    return;
  }

  flushAnswer(): void {
    this.forwardReasoning();
    this.forwardAnswer();
  }

  private forwardAnswer(): void {
    const split = splitReasoning(this.answerBuffer);
    this.forwardText("reasoning", split.reasoning, "forwardedReasoning");
    this.forwardText("answer", split.answer, "forwardedAnswer");
  }

  private forwardReasoning(): void {
    this.forwardText("reasoning", this.reasoningBuffer, "forwardedReasoning");
  }

  private forwardText(
    channel: "answer" | "reasoning",
    text: string,
    marker: "forwardedAnswer" | "forwardedReasoning",
  ): void {
    if (!text || text.length <= this[marker]) {
      return;
    }
    const next = text.slice(this[marker]);
    this[marker] = text.length;
    this.progress?.({ type: "delta", channel, text: next });
  }
}
