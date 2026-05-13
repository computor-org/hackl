import type { ChatBackend, ChatDelta, ChatMessage } from "./chatClient";
import { splitReasoning } from "./reasoning";
import {
  buildToolResultMessage,
  isPossibleToolPrefix,
  parseToolRequest,
  ToolRequest,
  ToolResult,
} from "./tools";

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
  signal?: AbortSignal;
}

export interface ToolLoopAnswer {
  content: string;
  reasoning?: string;
}

export async function completeWithTools(options: ToolLoopOptions): Promise<ToolLoopAnswer> {
  const messages = [...options.messages];

  for (let toolCalls = 0; toolCalls <= options.maxToolCalls; toolCalls++) {
    if (options.signal?.aborted) {
      throw new DOMException("Cancelled", "AbortError");
    }
    const router = new DeltaRouter(options.progress);
    const completion = await options.backend.complete(messages, {
      onDelta: (delta) => router.handle(delta),
      signal: options.signal,
    });
    router.flush();

    const content = completion.content;
    const request = parseToolRequest(content);
    if (!request) {
      const split = splitReasoning(content);
      return {
        content: split.answer || content,
        reasoning: completion.reasoning || split.reasoning || undefined,
      };
    }

    messages.push({ role: "assistant", content });
    if (toolCalls === options.maxToolCalls) {
      break;
    }

    options.progress?.({ type: "phase", text: `Running tool: ${formatToolRequest(request)}` });
    const result = await options.runTool(request);
    messages.push({ role: "user", content: buildToolResultMessage(request, result) });
  }

  return forceFinalAnswer(messages, options);
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
  const completion = await options.backend.complete(nudged, {
    onDelta: (delta) => router.handle(delta),
    signal: options.signal,
  });
  router.flush();

  const cleaned = stripToolCalls(completion.content);
  const split = splitReasoning(cleaned);
  const answer = split.answer || cleaned;
  return {
    content: answer.trim() || "(no answer)",
    reasoning: completion.reasoning || split.reasoning || undefined,
  };
}

function stripToolCalls(content: string): string {
  return content.replace(/HACKL_TOOL\s*\{[\s\S]*?\}/g, "").trim();
}

class DeltaRouter {
  private answerBuffer = "";
  private reasoningBuffer = "";
  private forwardedAnswer = 0;
  private forwardedReasoning = 0;
  private bufferedForTool = "";
  private decidedToolCall = false;

  constructor(private readonly progress: ((event: PromptProgress) => void) | undefined) {}

  handle(delta: ChatDelta): void {
    if (delta.type === "reasoning") {
      this.reasoningBuffer += delta.text;
      this.forwardReasoning();
      return;
    }

    this.answerBuffer += delta.text;
    if (this.shouldHoldToolPrefix()) {
      return;
    }
    this.forwardAnswer();
  }

  flush(): void {
    this.forwardReasoning();
    if (!this.decidedToolCall) {
      this.forwardAnswer();
    }
  }

  private shouldHoldToolPrefix(): boolean {
    if (this.decidedToolCall) {
      return true;
    }

    this.bufferedForTool = this.answerBuffer;
    if (this.bufferedForTool.trimStart().startsWith("HACKL_TOOL")) {
      this.decidedToolCall = true;
      return true;
    }
    if (isPossibleToolPrefix(this.bufferedForTool) && this.bufferedForTool.trim().length < 10) {
      return true;
    }
    return false;
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
