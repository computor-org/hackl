import { app, BrowserWindow, shell } from "electron";
import * as path from "node:path";
import { createHacklServer, createServerAgent } from "@hackl/server";
import type { HacklServer } from "@hackl/server";
import { EngineSessionLease } from "@hackl/core";

// Thin desktop shell: start the same loopback server the CLI's `hackl serve`
// uses, then load the shared web UI in a sandboxed window. No agent logic lives
// here. The token in server.url is swapped into an HttpOnly cookie by the server
// bootstrap on first load, so it never persists in the window URL.
const allowYolo = process.argv.includes("--allow-yolo");
let server: HacklServer | undefined;
let lease: EngineSessionLease | undefined;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

async function start(): Promise<void> {
  const env = { ...process.env };
  if (!env.HACKL_ENDPOINT?.trim()) {
    lease = await EngineSessionLease.acquire({
      kind: "desktop",
      hostCommand: {
        command: process.execPath,
        args: [path.join(__dirname, "engine-host.js")],
        options: { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
      },
    });
    env.HACKL_ENDPOINT = lease.status.endpoint;
    env.HACKL_MODEL = lease.status.model;
  }
  const agent = await createServerAgent(env);
  server = await createHacklServer({
    cwd: process.cwd(),
    host: "127.0.0.1",
    port: 0,
    allowYolo,
    staticDir: path.join(__dirname, "webui"),
    backend: agent.backend,
    sessionConfig: agent.sessionConfig,
    endpoint: agent.endpoint,
    model: agent.model,
  });

  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    title: "Hackl",
    backgroundColor: "#1e1e1e",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  // External links open in the system browser, never in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  await win.loadURL(server.url);
}

app.whenReady().then(start).catch((error) => {
  // eslint-disable-next-line no-console
  console.error("hackl desktop failed to start:", error);
  app.quit();
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void Promise.all([server?.close(), lease?.release()]).finally(() => app.exit());
});

app.on("window-all-closed", () => {
  app.quit();
});
