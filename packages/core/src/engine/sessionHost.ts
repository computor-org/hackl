import * as fs from "node:fs";
import * as net from "node:net";
import { EngineManager, type EngineStatus } from "./manager";
import { readEngineState, stopEngineAndWait } from "./supervisor";
import { sessionEndpoint, stateDir } from "./paths";
import {
  ENGINE_LEASE_TIMEOUT_MS,
  ENGINE_SESSION_VERSION,
  type EngineClientInfo,
  type EngineHostMode,
  type EngineSessionReply,
  type EngineSessionRequest,
  type EngineSessionStatus,
  isEngineSessionRequest,
} from "./sessionTypes";

interface Lease {
  client: EngineClientInfo;
  expiresAt: number;
}

export interface EngineSessionHostOptions {
  mode: EngineHostMode;
  env?: NodeJS.ProcessEnv;
  leaseTimeoutMs?: number;
  allowRemote?: boolean;
  manager?: EngineManager;
}

export class EngineSessionHost {
  private readonly env: NodeJS.ProcessEnv;
  private readonly manager: EngineManager;
  private readonly leases = new Map<string, Lease>();
  private readonly logListeners = new Set<(text: string) => void>();
  private readonly closedPromise: Promise<void>;
  private resolveClosed!: () => void;
  private server?: net.Server;
  private timer?: ReturnType<typeof setInterval>;
  private starting?: Promise<void>;
  private owner?: EngineClientInfo;
  private ownsEngine = false;
  private everAcquired = false;
  private closed = false;
  private readonly startedAt = Date.now();

  constructor(private readonly options: EngineSessionHostOptions) {
    this.env = options.env ?? process.env;
    this.manager = options.manager ?? new EngineManager(this.env);
    this.closedPromise = new Promise((resolve) => { this.resolveClosed = resolve; });
  }

  async listen(initialAlias?: string, log?: (text: string) => void): Promise<boolean> {
    if (!await this.bind()) return false;
    this.timer = setInterval(() => { void this.expireLeases(); }, 1000);
    this.timer.unref();
    if (initialAlias !== undefined || this.options.mode === "foreground") {
      this.owner = { id: "foreground", kind: "serve", pid: process.pid };
      try {
        await this.ensureEngine(initialAlias, log);
      } catch (error) {
        await this.close();
        throw error;
      }
    }
    return true;
  }

  waitForClose(): Promise<void> {
    return this.closedPromise;
  }

  async close(): Promise<void> {
    if (this.closed) return this.closedPromise;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.ownsEngine) await stopEngineAndWait(this.env);
    if (process.platform !== "win32") {
      try { fs.rmSync(sessionEndpoint(this.env)); } catch { /* already absent */ }
    }
    await closeServer(this.server);
    this.resolveClosed();
  }

  async status(): Promise<EngineSessionStatus> {
    const status = await this.manager.status();
    return this.describe(status);
  }

  private async bind(): Promise<boolean> {
    const endpoint = sessionEndpoint(this.env);
    fs.mkdirSync(stateDir(this.env), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(stateDir(this.env), 0o700); } catch { /* best effort on Windows */ }
    if (process.platform !== "win32" && fs.existsSync(endpoint)) {
      if (await endpointIsLive(endpoint)) return false;
      try { fs.rmSync(endpoint); } catch { /* raced with another host */ }
    }
    const server = net.createServer((socket) => this.handleSocket(socket));
    try {
      await listen(server, endpoint);
      if (process.platform !== "win32") fs.chmodSync(endpoint, 0o600);
      this.server = server;
      return true;
    } catch (error) {
      server.close();
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") return false;
      throw error;
    }
  }

  private handleSocket(socket: net.Socket): void {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = "";
      void this.handleLine(line, socket);
    });
  }

  private async handleLine(line: string, socket: net.Socket): Promise<void> {
    const send = (reply: EngineSessionReply): void => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(reply)}\n`);
    };
    try {
      const request: unknown = JSON.parse(line);
      if (!isEngineSessionRequest(request)) throw new Error("invalid engine session request");
      if (request.version !== ENGINE_SESSION_VERSION) {
        throw new Error(`engine session protocol ${request.version} is incompatible with ${ENGINE_SESSION_VERSION}`);
      }
      send({
        ok: true,
        status: await this.dispatch(
          request,
          (text) => send({ event: "log", text }),
          () => !socket.destroyed,
        ),
      });
    } catch (error) {
      send({ ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      socket.end();
    }
  }

  private async dispatch(
    request: EngineSessionRequest,
    log: (text: string) => void,
    connected: () => boolean,
  ): Promise<EngineSessionStatus> {
    switch (request.action) {
      case "status":
        return this.status();
      case "heartbeat": {
        const lease = this.leases.get(request.clientId);
        if (lease) lease.expiresAt = Date.now() + this.leaseTimeout();
        return this.status();
      }
      case "release":
        this.leases.delete(request.clientId);
        this.closeIfUnused();
        return this.status();
      case "acquire":
        return this.acquire(request.client, request.alias, log, connected);
    }
  }

  private async acquire(
    client: EngineClientInfo,
    alias: string | undefined,
    log: (text: string) => void,
    connected: () => boolean,
  ): Promise<EngineSessionStatus> {
    this.everAcquired = true;
    this.logListeners.add(log);
    try {
      await this.ensureEngine(alias, (text) => this.broadcastLog(text));
      this.assertCompatible(alias);
      if (!connected()) {
        this.closeIfUnused();
        throw new Error("engine client disconnected while the model was starting");
      }
      if (alias) this.manager.setConfig((config) => { config.model = alias; });
      if (!this.owner) this.owner = client;
      this.leases.set(client.id, { client, expiresAt: Date.now() + this.leaseTimeout() });
      return this.status();
    } finally {
      this.logListeners.delete(log);
      this.closeIfUnused();
    }
  }

  private async ensureEngine(alias?: string, log?: (text: string) => void): Promise<void> {
    if (this.starting) return this.starting;
    const current = await this.manager.status();
    if (current.state !== "stopped") {
      if (current.state === "running-external" && alias) {
        throw new Error(`an external server already owns ${current.endpoint}; Hackl cannot select ${alias} on it`);
      }
      this.ownsEngine = current.state === "running-managed";
      this.assertCompatible(alias);
      return;
    }
    this.starting = (async () => {
      const state = await this.manager.start({
        alias,
        allowDownload: true,
        allowRemote: this.options.allowRemote,
        log,
      });
      this.ownsEngine = true;
      if (alias) this.manager.setConfig((config) => { config.model = state.alias; });
    })();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private assertCompatible(alias?: string): void {
    if (!alias) return;
    const active = readEngineState(this.env)?.alias;
    if (active && active !== alias) {
      throw new Error(`local engine is owned with model ${active}; requested ${alias}. Stop the owning client first.`);
    }
  }

  private describe(status: EngineStatus): EngineSessionStatus {
    const state = readEngineState(this.env);
    return {
      state: this.starting ? "starting" : status.state,
      hostMode: this.options.mode,
      endpoint: status.endpoint,
      alias: status.state === "running-managed" ? state?.alias : undefined,
      model: status.model,
      pid: status.pid,
      owner: this.owner?.kind,
      leases: this.leases.size,
    };
  }

  private broadcastLog(text: string): void {
    for (const listener of this.logListeners) listener(text);
  }

  private leaseTimeout(): number {
    return this.options.leaseTimeoutMs ?? ENGINE_LEASE_TIMEOUT_MS;
  }

  private async expireLeases(): Promise<void> {
    const now = Date.now();
    for (const [id, lease] of this.leases) {
      if (lease.expiresAt <= now) this.leases.delete(id);
    }
    if (this.options.mode === "leased" && !this.everAcquired && now - this.startedAt >= 15_000) {
      await this.close();
      return;
    }
    this.closeIfUnused();
  }

  private closeIfUnused(): void {
    if (this.options.mode === "leased" && this.everAcquired && !this.starting && this.leases.size === 0) {
      setImmediate(() => { void this.close(); });
    }
  }
}

export async function runLeasedEngineHost(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const host = new EngineSessionHost({ mode: "leased", env });
  if (!await host.listen()) return;
  const shutdown = (): void => { void host.close(); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await host.waitForClose();
}

function listen(server: net.Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: net.Server | undefined): Promise<void> {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function endpointIsLive(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(endpoint);
    const done = (live: boolean): void => { socket.destroy(); resolve(live); };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(250, () => done(false));
  });
}
