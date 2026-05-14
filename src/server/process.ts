import { ChildProcess, spawn } from "node:child_process";
import * as net from "node:net";
import { EventEmitter } from "node:events";

export type ServerPhase = "idle" | "starting" | "ready" | "stopping" | "stopped" | "error";

export interface ServerEvents {
  phase: (phase: ServerPhase, detail?: string) => void;
  log: (line: string) => void;
}

export interface LlamaServerOptions {
  binaryPath: string;
  args: string[];
  port: number;
  readyTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class LlamaServer extends EventEmitter {
  private child?: ChildProcess;
  private currentPhase: ServerPhase = "idle";
  private readonly opts: LlamaServerOptions;

  constructor(opts: LlamaServerOptions) {
    super();
    this.opts = opts;
  }

  get phase(): ServerPhase { return this.currentPhase; }

  get endpoint(): string { return `http://127.0.0.1:${this.opts.port}/v1`; }

  async start(): Promise<void> {
    if (this.currentPhase === "ready" || this.currentPhase === "starting") return;
    this.setPhase("starting");
    const child = spawn(this.opts.binaryPath, this.opts.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    const captureLine = (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line) this.emit("log", line);
      }
    };
    child.stdout?.on("data", captureLine);
    child.stderr?.on("data", captureLine);
    child.on("exit", (code, signal) => {
      const wasRunning = this.currentPhase === "ready" || this.currentPhase === "starting";
      this.child = undefined;
      if (this.currentPhase === "stopping") {
        this.setPhase("stopped");
      } else if (wasRunning) {
        this.setPhase("error", `llama-server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
      }
    });
    child.on("error", (err) => {
      this.setPhase("error", err.message);
    });
    const timeoutMs = this.opts.readyTimeoutMs ?? 30000;
    const deadline = Date.now() + timeoutMs;
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    while (Date.now() < deadline) {
      if (!this.child) throw new Error("llama-server exited before becoming ready");
      try {
        const res = await fetchImpl(`${this.endpoint}/models`, { signal: AbortSignal.timeout(800) });
        if (res.ok) {
          this.setPhase("ready");
          return;
        }
      } catch { /* still booting */ }
      await delay(300);
    }
    await this.stop();
    throw new Error("llama-server failed to become ready within timeout");
  }

  async stop(): Promise<void> {
    if (!this.child || this.currentPhase === "stopped" || this.currentPhase === "idle") {
      this.setPhase("stopped");
      return;
    }
    this.setPhase("stopping");
    const child = this.child;
    child.kill("SIGTERM");
    const gracePeriod = 5000;
    const start = Date.now();
    while (this.child && Date.now() - start < gracePeriod) {
      await delay(100);
    }
    if (this.child) {
      this.child.kill("SIGKILL");
      await delay(200);
    }
    this.setPhase("stopped");
  }

  private setPhase(phase: ServerPhase, detail?: string): void {
    this.currentPhase = phase;
    this.emit("phase", phase, detail);
  }
}

export async function findFreePort(start: number, end: number): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (await isFree(port)) return port;
  }
  throw new Error(`No free port in ${start}-${end}`);
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, "127.0.0.1");
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
