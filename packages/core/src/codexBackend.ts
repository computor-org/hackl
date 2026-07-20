import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  ChatBackend,
  ChatCompleteOptions,
  ChatCompletion,
  ChatMessage,
} from "./chatClient";

export interface CodexBackendOptions {
  command?: string;
  model: string;
  cwd?: string;
  clientVersion?: string;
  /** Override spawn for tests. */
  spawnImpl?: typeof spawn;
}

export function createCodexAppServerBackend(options: CodexBackendOptions): CodexBackend {
  return new CodexBackend(options);
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

type IncomingFrame = JsonRpcResponse | JsonRpcNotification;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface ActiveTurn {
  threadId: string;
  turnId?: string;
  answer: string[];
  reasoning: string[];
  onDelta?: (delta: import("./chatClient").ChatDelta) => void;
  resolve(completion: ChatCompletion): void;
  reject(error: Error): void;
  settled: boolean;
}

/**
 * Maintains one `codex app-server` child process per backend instance and
 * exposes the OpenAI-compatible `ChatBackend.complete` API on top of it.
 *
 * The codex protocol is conversational (threads + turns), but hackl's
 * tool loop treats every call as stateless: we therefore start a fresh
 * thread per `complete()` call. Multi-turn history is still preserved
 * because the caller passes the full message history each time.
 */
export class CodexBackend implements ChatBackend {
  private child: ChildProcessWithoutNullStreams | undefined;
  private childError: Error | undefined;
  private childClosed = false;
  private stdoutBuffer = "";
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private activeTurn: ActiveTurn | undefined;
  private initPromise: Promise<void> | undefined;

  constructor(private readonly options: CodexBackendOptions) {}

  dispose(): void {
    if (this.child && !this.childClosed) {
      try { this.child.kill(); } catch {}
    }
    this.child = undefined;
    this.childClosed = true;
    this.rejectAll(new Error("Codex backend disposed."));
  }

  async complete(messages: ChatMessage[], options: ChatCompleteOptions = {}): Promise<ChatCompletion> {
    await this.ensureChild();
    const threadResponse = await this.request("thread/start", {
      model: this.options.model,
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
    });
    const threadId = readThreadId(threadResponse);
    if (!threadId) {
      throw new Error("Codex thread/start did not return a thread id.");
    }
    const input = messagesToCodexInput(messages);
    return new Promise<ChatCompletion>((resolve, reject) => {
      const turn: ActiveTurn = {
        threadId,
        answer: [],
        reasoning: [],
        onDelta: options.onDelta,
        resolve,
        reject,
        settled: false,
      };
      this.activeTurn = turn;

      const onAbort = () => {
        this.send({
          jsonrpc: "2.0",
          method: "turn/interrupt",
          params: { threadId },
        });
        this.finishTurn(turn, new Error("Cancelled"));
      };
      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      this.request("turn/start", { threadId, input, model: this.options.model })
        .catch((error) => this.finishTurn(turn, error instanceof Error ? error : new Error(String(error))));
    });
  }

  private async ensureChild(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.startChild().catch((error) => {
      this.initPromise = undefined;
      throw error;
    });
    return this.initPromise;
  }

  private async startChild(): Promise<void> {
    const command = this.options.command || "codex";
    const spawnImpl = this.options.spawnImpl ?? spawn;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnImpl(command, ["app-server", "--listen", "stdio://"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      throw new Error(`Could not launch ${command}: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.child = child;
    this.childClosed = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => this.onStdout(data));
    child.stderr.on("data", () => {
      // Codex emits diagnostics on stderr; ignore for now (debug log captures via parent).
    });
    child.on("error", (error) => {
      this.childError = error;
      this.rejectAll(error);
    });
    child.on("close", () => {
      this.childClosed = true;
      this.rejectAll(this.childError ?? new Error("Codex app-server exited."));
    });
    await this.request("initialize", {
      clientInfo: { name: "hackl", version: this.options.clientVersion ?? "0.0.0" },
    });
    this.send({ jsonrpc: "2.0", method: "initialized" });
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    for (;;) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let frame: IncomingFrame;
      try {
        frame = JSON.parse(line) as IncomingFrame;
      } catch {
        continue;
      }
      this.dispatchFrame(frame);
    }
  }

  private dispatchFrame(frame: IncomingFrame): void {
    if ("id" in frame && (frame.result !== undefined || frame.error !== undefined)) {
      const id = typeof frame.id === "number" ? frame.id : Number(frame.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (frame.error) {
        pending.reject(new Error(frame.error.message || `codex error ${frame.error.code}`));
      } else {
        pending.resolve(frame.result);
      }
      return;
    }
    if ("method" in frame) {
      this.handleNotification(frame.method, frame.params);
    }
  }

  private handleNotification(method: string, params: unknown): void {
    const turn = this.activeTurn;
    if (!turn || turn.settled) return;
    const p = (params ?? {}) as Record<string, unknown>;
    if (typeof p.threadId === "string" && p.threadId !== turn.threadId) return;
    switch (method) {
      case "turn/started": {
        if (typeof p.turnId === "string") turn.turnId = p.turnId;
        return;
      }
      case "item/agentMessage/delta": {
        const delta = typeof p.delta === "string" ? p.delta : "";
        if (!delta) return;
        turn.answer.push(delta);
        turn.onDelta?.({ type: "answer", text: delta });
        return;
      }
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryTextDelta": {
        const delta = typeof p.delta === "string" ? p.delta : "";
        if (!delta) return;
        turn.reasoning.push(delta);
        turn.onDelta?.({ type: "reasoning", text: delta });
        return;
      }
      case "turn/completed": {
        this.finishTurn(turn, undefined);
        return;
      }
      case "error": {
        const message = typeof p.message === "string" ? p.message : "Codex error";
        this.finishTurn(turn, new Error(message));
        return;
      }
      default:
        return;
    }
  }

  private finishTurn(turn: ActiveTurn, error: Error | undefined): void {
    if (turn.settled) return;
    turn.settled = true;
    if (this.activeTurn === turn) this.activeTurn = undefined;
    if (error) {
      turn.reject(error);
      return;
    }
    const completion: ChatCompletion = {
      content: turn.answer.join(""),
      ...(turn.reasoning.length ? { reasoning: turn.reasoning.join("") } : {}),
    };
    turn.resolve(completion);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0" as const, id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.send(payload);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private send(frame: unknown): void {
    if (!this.child || this.childClosed) {
      throw new Error("Codex app-server is not running.");
    }
    this.child.stdin.write(JSON.stringify(frame) + "\n");
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    if (this.activeTurn) {
      this.finishTurn(this.activeTurn, error);
    }
  }
}

function readThreadId(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const r = response as { thread?: { id?: unknown }; threadId?: unknown };
  if (typeof r.threadId === "string") return r.threadId;
  if (r.thread && typeof r.thread === "object") {
    const id = (r.thread as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

export function messagesToCodexInput(messages: ChatMessage[]): Array<{ type: "text"; text: string }> {
  const parts: string[] = [];
  for (const message of messages) {
    if (!message.content) continue;
    if (message.role === "system") {
      parts.push(`[system]\n${message.content}`);
    } else if (message.role === "assistant") {
      parts.push(`[assistant previous turn]\n${message.content}`);
    } else {
      parts.push(message.content);
    }
  }
  const text = parts.join("\n\n").trim();
  return text ? [{ type: "text", text }] : [];
}
