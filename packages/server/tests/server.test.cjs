const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const { WebSocket } = require("ws");
const { createHacklServer } = require("../dist/index.js");

const sessionConfig = { maxToolFileChars: 4000, maxContextTokens: 8192 };

// A scripted ChatBackend: returns the next assistant content on each complete()
// call, ignoring messages/streaming. Lets us drive turns deterministically.
function stubBackend(scripts) {
  let i = 0;
  return {
    async complete() {
      const content = scripts[Math.min(i, scripts.length - 1)];
      i += 1;
      return { content };
    },
  };
}

async function withServer(options, fn) {
  const server = await createHacklServer({ cwd: process.cwd(), sessionConfig, ...options });
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

function connect(server, token) {
  const t = token ?? server.token;
  return new WebSocket(`ws://${server.host}:${server.port}/?token=${t}`);
}

function drive(ws, onMessage) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const timer = setTimeout(() => reject(new Error("timed out")), 15000);
    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());
      messages.push(message);
      const done = onMessage(message, ws);
      if (done) {
        clearTimeout(timer);
        resolve(messages);
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test("streams an ask turn end to end", async () => {
  await withServer({ backend: stubBackend(["Hello from the stub."]) }, async (server) => {
    const ws = connect(server);
    ws.on("open", () => ws.send(JSON.stringify({ type: "prompt", mode: "ask", prompt: "hi" })));
    const messages = await drive(ws, (m) => m.type === "done");
    ws.close();
    const done = messages.find((m) => m.type === "done");
    assert.ok(done, "expected a done event");
    assert.match(done.content, /Hello from the stub/);
    assert.ok(messages.some((m) => m.type === "state"), "expected an initial state event");
  });
});

test("rejects a bad token on the WebSocket upgrade", async () => {
  await withServer({ backend: stubBackend(["x"]) }, async (server) => {
    const ws = connect(server, "wrong-token");
    await new Promise((resolve, reject) => {
      ws.on("open", () => {
        ws.close();
        reject(new Error("connection should not open with a bad token"));
      });
      ws.on("error", () => resolve());
      ws.on("unexpected-response", () => resolve());
    });
  });
});

test("runs the approval round-trip for a gated command in agent mode", async () => {
  const scripts = ['HACKL_TOOL {"name":"run_command","cmd":"echo","args":["hi"]}', "Command finished."];
  await withServer({ backend: stubBackend(scripts) }, async (server) => {
    const ws = connect(server);
    ws.on("open", () => ws.send(JSON.stringify({ type: "prompt", mode: "agent", prompt: "run it" })));
    const messages = await drive(ws, (m, socket) => {
      if (m.type === "approvalRequested") {
        socket.send(JSON.stringify({ type: "approvalResponse", approvalId: m.id, approved: true }));
      }
      return m.type === "done";
    });
    ws.close();
    assert.ok(messages.some((m) => m.type === "approvalRequested"), "expected an approval request");
    const done = messages.find((m) => m.type === "done");
    assert.ok(done, "expected a done event");
    assert.match(done.content, /Command finished/);
  });
});

test("responds to an engine status request over the WebSocket", async () => {
  await withServer({ backend: stubBackend(["x"]) }, async (server) => {
    const ws = connect(server);
    ws.on("open", () => ws.send(JSON.stringify({ type: "engine", action: "status" })));
    const messages = await drive(ws, (m) => m.type === "engineState");
    ws.close();
    const st = messages.find((m) => m.type === "engineState");
    assert.ok(st, "expected an engineState reply");
    assert.ok(["running-managed", "running-external", "stopped"].includes(st.status.state));
  });
});

test("blocks yolo mode unless the server allows it", async () => {
  await withServer({ backend: stubBackend(["x"]) }, async (server) => {
    const ws = connect(server);
    ws.on("open", () => ws.send(JSON.stringify({ type: "prompt", mode: "yolo", prompt: "hi" })));
    const messages = await drive(ws, (m) => m.type === "error");
    ws.close();
    assert.ok(messages.some((m) => m.type === "error" && /yolo/i.test(m.message)));
  });
});

test("bootstrap sets an HttpOnly cookie and redirects the token out of the URL", async () => {
  await withServer({ backend: stubBackend(["x"]) }, async (server) => {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://${server.host}:${server.port}/?token=${server.token}`, resolve).on("error", reject);
    });
    res.resume();
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, "/");
    assert.match(String(res.headers["set-cookie"]), /hackl_token=.*HttpOnly.*SameSite=Strict/);
    assert.match(String(res.headers["content-security-policy"] || ""), /default-src 'self'/);
  });
});

test("authenticates the WebSocket from the cookie with no token in the URL", async () => {
  await withServer({ backend: stubBackend(["hi"]) }, async (server) => {
    const origin = `http://${server.host}:${server.port}`;
    const ws = new WebSocket(`${origin}/`, { headers: { Cookie: `hackl_token=${server.token}`, Origin: origin } });
    const state = await new Promise((resolve, reject) => {
      ws.on("message", (data) => {
        const m = JSON.parse(data.toString());
        if (m.type === "state") resolve(m);
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("timed out")), 8000);
    });
    ws.close();
    assert.equal(state.connected, true);
  });
});

test("allows yolo mode when started with allowYolo", async () => {
  await withServer({ backend: stubBackend(["yolo ok"]), allowYolo: true }, async (server) => {
    const state = await new Promise((resolve, reject) => {
      const ws = connect(server);
      ws.on("message", (data) => {
        const m = JSON.parse(data.toString());
        if (m.type === "state") {
          ws.close();
          resolve(m);
        }
      });
      ws.on("error", reject);
    });
    assert.equal(state.yoloAllowed, true);
  });
});
