import * as crypto from "node:crypto";
import * as net from "node:net";
import { spawn, type SpawnOptions } from "node:child_process";
import { sessionEndpoint } from "./paths";
import {
  ENGINE_HEARTBEAT_MS,
  ENGINE_SESSION_VERSION,
  type EngineClientKind,
  type EngineSessionReply,
  type EngineSessionRequest,
  type EngineSessionStatus,
} from "./sessionTypes";

export interface EngineHostCommand {
  command: string;
  args: string[];
  options?: SpawnOptions;
}

export interface AcquireEngineOptions {
  kind: EngineClientKind;
  alias?: string;
  env?: NodeJS.ProcessEnv;
  hostCommand?: EngineHostCommand;
  log?: (text: string) => void;
  heartbeatMs?: number;
}

export class EngineSessionLease {
  private timer?: ReturnType<typeof setInterval>;
  private released = false;

  private constructor(
    readonly id: string,
    readonly status: EngineSessionStatus,
    private readonly options: AcquireEngineOptions,
  ) {}

  static async acquire(options: AcquireEngineOptions): Promise<EngineSessionLease> {
    let acquired = await tryAcquire(options);
    if (!acquired && options.hostCommand) {
      spawnHost(options.hostCommand);
      acquired = await waitForAcquire(options);
    }
    if (!acquired) throw new Error("no Hackl engine session is running");
    const lease = new EngineSessionLease(acquired.id, acquired.status, options);
    if (acquired.status.state === "running-managed") lease.startHeartbeat();
    return lease;
  }

  static async acquireExisting(options: AcquireEngineOptions): Promise<EngineSessionLease | undefined> {
    const acquired = await tryAcquire(options);
    if (!acquired) return undefined;
    const lease = new EngineSessionLease(acquired.id, acquired.status, options);
    if (acquired.status.state === "running-managed") lease.startHeartbeat();
    return lease;
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    if (this.timer) clearInterval(this.timer);
    await request(
      { version: ENGINE_SESSION_VERSION, action: "release", clientId: this.id },
      this.options.env,
    ).catch(() => undefined);
  }

  private startHeartbeat(): void {
    const interval = this.options.heartbeatMs ?? ENGINE_HEARTBEAT_MS;
    this.timer = setInterval(() => {
      void request(
        { version: ENGINE_SESSION_VERSION, action: "heartbeat", clientId: this.id },
        this.options.env,
      ).catch(() => undefined);
    }, interval);
    this.timer.unref();
  }
}

export async function queryEngineSession(env: NodeJS.ProcessEnv = process.env): Promise<EngineSessionStatus | undefined> {
  return request({ version: ENGINE_SESSION_VERSION, action: "status" }, env).catch(() => undefined);
}

interface Acquired {
  id: string;
  status: EngineSessionStatus;
}

async function tryAcquire(options: AcquireEngineOptions): Promise<Acquired | undefined> {
  const requestMessage: EngineSessionRequest = {
    version: ENGINE_SESSION_VERSION,
    action: "acquire",
    client: { id: crypto.randomUUID(), kind: options.kind, pid: process.pid },
    alias: options.alias,
  };
  const result = await request(requestMessage, options.env, options.log).catch((error) => {
    if (isMissingSession(error)) return undefined;
    throw error;
  });
  return result ? { id: requestMessage.client.id, status: result } : undefined;
}

async function waitForAcquire(options: AcquireEngineOptions): Promise<Acquired> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const status = await tryAcquire(options);
      if (status) return status;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError instanceof Error ? lastError : new Error("timed out starting Hackl engine session");
}

function spawnHost(host: EngineHostCommand): void {
  const child = spawn(host.command, host.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    ...host.options,
  });
  child.unref();
}

function request(
  message: EngineSessionRequest,
  env: NodeJS.ProcessEnv = process.env,
  log?: (text: string) => void,
): Promise<EngineSessionStatus> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(sessionEndpoint(env));
    let buffer = "";
    let settled = false;
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(message)}\n`));
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const reply = JSON.parse(line) as EngineSessionReply;
        if ("event" in reply) log?.(reply.text);
        else if (reply.ok) { settled = true; resolve(reply.status); }
        else { settled = true; reject(new Error(reply.error)); }
        newline = buffer.indexOf("\n");
      }
    });
    socket.once("close", () => {
      if (!settled) reject(new Error("engine session closed without a response"));
    });
  });
}

function isMissingSession(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ECONNREFUSED" || code === "EPIPE";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
