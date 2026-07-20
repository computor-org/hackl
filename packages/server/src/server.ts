import * as http from "node:http";
import * as crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { runHacklPrompt, createNodeWorkspaceHost, EngineManager, applyEngineSet } from "@hackl/core";
import type {
  ChatBackend,
  McpManager,
  SessionConfig,
  SessionDeps,
  ApprovalRequest,
  ConversationMessage,
  PromptMode,
} from "@hackl/core";
import type { ClientMessage, ServerMessage } from "@hackl/protocol";
import { ALL_MODES, DEFAULT_MODE } from "@hackl/protocol";
import { isAllowedHost, isAllowedOrigin, extractToken, timingSafeEqual, TOKEN_COOKIE } from "./auth";
import { createStaticHandler } from "./static";

// Strict headers for every served response. CSP keeps the UI same-origin and
// only lets it reach a loopback WebSocket; Referrer-Policy stops the URL (and
// thus any leaked credential) from riding outbound Referer headers.
const SECURITY_HEADERS: Record<string, string> = {
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'",
};

export interface HacklServerOptions {
  cwd: string;
  backend: ChatBackend;
  sessionConfig: SessionConfig;
  host?: string;
  port?: number;
  token?: string;
  allowYolo?: boolean;
  staticDir?: string;
  mcp?: McpManager;
  endpoint?: string;
  model?: string;
}

export interface HacklServer {
  url: string;
  token: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

export async function createHacklServer(options: HacklServerOptions): Promise<HacklServer> {
  const host = options.host ?? "127.0.0.1";
  const token = options.token ?? crypto.randomBytes(32).toString("hex");
  const allowYolo = options.allowYolo ?? false;
  const workspace = createNodeWorkspaceHost(options.cwd);
  const serveStatic = options.staticDir ? createStaticHandler(options.staticDir, SECURITY_HEADERS) : undefined;

  const httpServer = http.createServer((req, res) => {
    if ((req.url ?? "").split("?")[0] === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (!isAllowedHost(req)) {
      res.writeHead(403);
      res.end("forbidden host");
      return;
    }
    // Bootstrap: a one-time ?token=<t> on GET sets an HttpOnly cookie and
    // redirects to a token-free URL, so the credential never lingers in the
    // address bar, history, or Referer.
    const query = new URL(req.url ?? "/", "http://localhost").searchParams.get("token");
    if (query && timingSafeEqual(query, token)) {
      res.writeHead(302, {
        ...SECURITY_HEADERS,
        "set-cookie": `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
        location: "/",
      });
      res.end();
      return;
    }
    if (serveStatic) {
      serveStatic(req, res);
      return;
    }
    res.writeHead(404, SECURITY_HEADERS);
    res.end("hackl server: no UI bundled; connect over the WebSocket");
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const supplied = extractToken(req);
    if (!isAllowedHost(req) || !isAllowedOrigin(req) || !supplied || !timingSafeEqual(supplied, token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, { workspace, options, allowYolo });
    });
  });

  const port = await listen(httpServer, host, options.port ?? 0);
  const url = `http://${host}:${port}/?token=${token}`;

  return {
    url,
    token,
    host,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => httpServer.close(() => resolve()));
      }),
  };
}

function listen(server: http.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(address.port);
      } else {
        reject(new Error("server did not bind a port"));
      }
    });
  });
}

interface ConnectionContext {
  workspace: ReturnType<typeof createNodeWorkspaceHost>;
  options: HacklServerOptions;
  allowYolo: boolean;
}

function handleConnection(ws: WebSocket, ctx: ConnectionContext): void {
  const history: ConversationMessage[] = [];
  const approvals = new Map<string, (approved: boolean) => void>();
  let controller: AbortController | undefined;
  let nextApprovalId = 1;

  const send = (message: ServerMessage): void => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  send({
    type: "state",
    connected: true,
    endpoint: ctx.options.endpoint,
    model: ctx.options.model,
    modes: ALL_MODES,
    defaultMode: DEFAULT_MODE,
    yoloAllowed: ctx.allowYolo,
  });

  const engine = new EngineManager();

  const handleEngine = async (action: string, alias?: string, allowRemote?: boolean): Promise<void> => {
    try {
      switch (action) {
        case "status": send({ type: "engineState", status: await engine.status() }); return;
        case "doctor": send({ type: "engineDoctor", report: await engine.doctor() }); return;
        case "list": send({ type: "engineModels", models: engine.listModels() }); return;
        case "up": {
          await engine.start({ alias, allowDownload: true, allowRemote, log: (t) => send({ type: "engineLog", text: t }) });
          send({ type: "engineState", status: await engine.status() });
          return;
        }
        case "down": engine.stop(); send({ type: "engineState", status: await engine.status() }); return;
        case "pull": {
          if (alias) await engine.pull(alias, (t) => send({ type: "engineLog", text: t }));
          send({ type: "engineModels", models: engine.listModels() });
          return;
        }
        case "restart": {
          await engine.restart({ alias, allowDownload: true, allowRemote, log: (t) => send({ type: "engineLog", text: t }) });
          send({ type: "engineState", status: await engine.status() });
          return;
        }
      }
    } catch (error) {
      send({ type: "engineLog", text: `error: ${error instanceof Error ? error.message : String(error)}` });
    }
  };

  const rejectApprovals = (): void => {
    for (const resolve of approvals.values()) resolve(false);
    approvals.clear();
  };

  const requestApproval = (request: ApprovalRequest): Promise<boolean> => {
    const id = String(nextApprovalId++);
    send({ type: "approvalRequested", id, ...request });
    return new Promise<boolean>((resolve) => {
      approvals.set(id, resolve);
    });
  };

  const runPrompt = async (prompt: string, mode: PromptMode): Promise<void> => {
    if (controller) {
      send({ type: "error", message: "A turn is already running. Cancel it before sending another prompt." });
      return;
    }
    if (mode === "yolo" && !ctx.allowYolo) {
      send({
        type: "error",
        message: "Yolo mode is disabled on this server. Start it with --allow-yolo to enable running any command without approval.",
      });
      return;
    }
    const previousHistory = [...history];
    history.push({ role: "user", content: prompt });
    controller = new AbortController();
    const signal = controller.signal;
    const deps: SessionDeps = {
      backend: ctx.options.backend,
      workspace: ctx.workspace,
      config: ctx.options.sessionConfig,
      mcp: ctx.options.mcp,
      requestApproval,
    };
    try {
      const answer = await runHacklPrompt(
        deps,
        { prompt, contextText: "", mode, history: previousHistory, signal },
        (event) => {
          if (!signal.aborted) send(event);
        },
      );
      if (signal.aborted) {
        history.pop();
        return;
      }
      history.push({ role: "assistant", content: answer.content });
    } catch (error) {
      history.pop();
      // runHacklPrompt already emitted an "error" event before throwing, unless
      // the turn was aborted. Nothing more to send.
      void error;
    } finally {
      controller = undefined;
      rejectApprovals();
    }
  };

  ws.on("message", (data) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case "ready":
        send({ type: "history", entries: [...history] });
        return;
      case "clear":
        controller?.abort();
        history.length = 0;
        send({ type: "cleared" });
        return;
      case "cancel":
        controller?.abort();
        rejectApprovals();
        return;
      case "approvalResponse": {
        const resolve = approvals.get(message.approvalId);
        if (resolve) {
          approvals.delete(message.approvalId);
          resolve(Boolean(message.approved));
        }
        return;
      }
      case "prompt": {
        const prompt = (message.prompt ?? "").trim();
        if (!prompt) return;
        void runPrompt(prompt, normalizeMode(message.mode));
        return;
      }
      case "engine":
        void handleEngine(message.action, message.alias, message.allowRemote);
        return;
      case "engineSet": {
        try {
          engine.setConfig((c) => applyEngineSet(c, message.key, message.value));
          send({ type: "engineModels", models: engine.listModels() });
        } catch (error) {
          send({ type: "engineLog", text: `error: ${error instanceof Error ? error.message : String(error)}` });
        }
        return;
      }
    }
  });

  ws.on("close", () => {
    controller?.abort();
    rejectApprovals();
  });
}

function normalizeMode(mode: PromptMode | undefined): PromptMode {
  return mode !== undefined && (ALL_MODES as string[]).includes(mode) ? mode : "ask";
}
