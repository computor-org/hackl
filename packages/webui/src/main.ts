import { ALL_MODES, DEFAULT_MODE } from "@hackl/protocol";
import type { ClientMessage, ServerMessage, PromptMode, ConversationMessage, EngineStatus, ModelEntry } from "@hackl/protocol";

const MODE_TITLES: Record<PromptMode, string> = {
  ask: "read only",
  edit: "read + edit",
  work: "read + edit + search",
  agent: "read + edit + search + approved commands",
  yolo: "DANGER: any command, no approval",
};

const el = {
  conn: must("conn"),
  meter: must("meter"),
  yoloBanner: must("yolo-banner"),
  thread: must("thread"),
  empty: must("empty"),
  composer: must("composer") as HTMLFormElement,
  prompt: must("prompt") as HTMLTextAreaElement,
  mode: must("mode") as HTMLSelectElement,
  send: must("send") as HTMLButtonElement,
  cancel: must("cancel") as HTMLButtonElement,
};

function must(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

let ws: WebSocket | undefined;
let running = false;
let yoloAllowed = false;
let assistantBody: HTMLElement | undefined;
let assistantReasoning: HTMLElement | undefined;
const statusLine = document.createElement("div");
statusLine.id = "status";

function send(message: ClientMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function connect(): void {
  const scheme = location.protocol === "https:" ? "wss://" : "ws://";
  ws = new WebSocket(`${scheme}${location.host}/`);
  ws.addEventListener("open", () => {
    el.conn.textContent = "connected";
    send({ type: "ready" });
    send({ type: "engine", action: "list" });
    send({ type: "engine", action: "status" });
  });
  ws.addEventListener("close", () => {
    el.conn.textContent = "disconnected";
    setRunning(false);
  });
  ws.addEventListener("message", (event) => {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(event.data)) as ServerMessage;
    } catch {
      return;
    }
    handle(message);
  });
}

function handle(message: ServerMessage): void {
  switch (message.type) {
    case "state":
      yoloAllowed = message.yoloAllowed;
      el.conn.textContent = message.model ? `${message.model}` : "connected";
      el.conn.title = message.endpoint ?? "";
      populateModes(message.modes, message.defaultMode);
      return;
    case "history":
      renderHistory(message.entries);
      return;
    case "phase":
      statusLine.textContent = message.text;
      ensureStatusVisible();
      return;
    case "token_budget":
      el.meter.textContent = `${message.inputTokens} / ${message.maxContextTokens} tok`;
      return;
    case "delta":
      appendDelta(message.channel, message.text);
      return;
    case "done":
      finishAssistant(message.content, message.reasoning);
      setRunning(false);
      return;
    case "error":
      appendError(message.message);
      setRunning(false);
      return;
    case "approvalRequested":
      appendApproval(message.id, message.title, message.detail, message.approveLabel, message.denyLabel);
      return;
    case "cleared":
      el.thread.replaceChildren();
      updateEmpty();
      return;
    case "userPrompt":
      appendUser(message.text);
      return;
    case "engineState":
      renderEngineStatus(message.status);
      return;
    case "engineModels":
      renderEngineModels(message.models);
      return;
    case "engineLog":
      appendEngineLog(message.text);
      return;
    case "engineDoctor":
      appendEngineLog(`recommended: ${message.report.recommendation.primary.alias} (${message.report.recommendation.budgetGB} GB)`);
      return;
  }
}

function populateModes(modes: PromptMode[], def: PromptMode): void {
  if (el.mode.options.length > 0) return;
  for (const mode of modes.length ? modes : ALL_MODES) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = mode;
    option.title = MODE_TITLES[mode] ?? mode;
    if (mode === "yolo" && !yoloAllowed) {
      option.disabled = true;
      option.textContent = "yolo (server --allow-yolo)";
    }
    el.mode.appendChild(option);
  }
  el.mode.value = (def && modes.includes(def)) ? def : DEFAULT_MODE;
  updateYoloBanner();
}

function updateYoloBanner(): void {
  el.yoloBanner.hidden = el.mode.value !== "yolo";
}

function renderHistory(entries: ConversationMessage[]): void {
  el.thread.replaceChildren();
  for (const entry of entries) {
    if (entry.role === "user") appendUser(entry.content);
    else if (entry.role === "assistant") {
      const node = newEntry("assistant");
      node.body.textContent = entry.content;
    }
  }
  updateEmpty();
}

interface EntryNodes { wrap: HTMLElement; body: HTMLElement; }

function newEntry(role: string): EntryNodes {
  const wrap = document.createElement("div");
  wrap.className = `entry ${role}`;
  const label = document.createElement("div");
  label.className = "role";
  label.textContent = role;
  const body = document.createElement("div");
  body.className = "body";
  wrap.append(label, body);
  el.thread.appendChild(wrap);
  scrollToEnd();
  updateEmpty();
  return { wrap, body };
}

function appendUser(text: string): void {
  newEntry("user").body.textContent = text;
}

function appendError(text: string): void {
  newEntry("error").body.textContent = text;
}

function startAssistant(): void {
  const wrap = document.createElement("div");
  wrap.className = "entry assistant";
  const label = document.createElement("div");
  label.className = "role";
  label.textContent = "hackl";
  assistantReasoning = document.createElement("div");
  assistantReasoning.className = "reasoning";
  assistantReasoning.hidden = true;
  assistantBody = document.createElement("div");
  assistantBody.className = "body";
  wrap.append(label, assistantReasoning, assistantBody);
  el.thread.appendChild(wrap);
  el.thread.appendChild(statusLine);
  scrollToEnd();
  updateEmpty();
}

function appendDelta(channel: "answer" | "reasoning", text: string): void {
  if (!assistantBody) startAssistant();
  if (channel === "reasoning" && assistantReasoning) {
    assistantReasoning.hidden = false;
    assistantReasoning.textContent = (assistantReasoning.textContent ?? "") + text;
  } else if (assistantBody) {
    assistantBody.textContent = (assistantBody.textContent ?? "") + text;
  }
  scrollToEnd();
}

function finishAssistant(content: string, reasoning?: string): void {
  if (!assistantBody) startAssistant();
  if (assistantBody) assistantBody.textContent = content;
  if (reasoning && assistantReasoning) {
    assistantReasoning.hidden = false;
    assistantReasoning.textContent = reasoning;
  }
  assistantBody = undefined;
  assistantReasoning = undefined;
  statusLine.textContent = "";
  scrollToEnd();
}

function appendApproval(id: string, title: string, detail: string, approveLabel: string, denyLabel: string): void {
  const card = document.createElement("div");
  card.className = "approval";
  const titleEl = document.createElement("div");
  titleEl.className = "title";
  titleEl.textContent = title;
  const detailEl = document.createElement("div");
  detailEl.className = "detail";
  detailEl.textContent = detail;
  const actions = document.createElement("div");
  actions.className = "actions";
  const approve = document.createElement("button");
  approve.textContent = approveLabel || "Approve";
  const deny = document.createElement("button");
  deny.textContent = denyLabel || "Deny";
  const resolve = (approved: boolean): void => {
    send({ type: "approvalResponse", approvalId: id, approved });
    approve.disabled = true;
    deny.disabled = true;
    card.classList.add("resolved");
  };
  approve.addEventListener("click", () => resolve(true));
  deny.addEventListener("click", () => resolve(false));
  actions.append(approve, deny);
  card.append(titleEl, detailEl, actions);
  el.thread.appendChild(card);
  scrollToEnd();
}

function setRunning(value: boolean): void {
  running = value;
  el.send.disabled = value;
  el.cancel.hidden = !value;
}

function ensureStatusVisible(): void {
  if (!statusLine.isConnected) el.thread.appendChild(statusLine);
}

function updateEmpty(): void {
  el.empty.hidden = el.thread.querySelector(".entry") !== null;
}

function scrollToEnd(): void {
  el.thread.scrollTop = el.thread.scrollHeight;
}

el.mode.addEventListener("change", updateYoloBanner);

el.prompt.addEventListener("input", () => {
  el.prompt.style.height = "auto";
  el.prompt.style.height = `${Math.min(el.prompt.scrollHeight, 200)}px`;
});

el.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    el.composer.requestSubmit();
  }
});

el.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = el.prompt.value.trim();
  if (!text || running) return;
  const mode = el.mode.value as PromptMode;
  appendUser(text);
  startAssistant();
  send({ type: "prompt", prompt: text, mode });
  setRunning(true);
  el.prompt.value = "";
  el.prompt.style.height = "auto";
});

el.cancel.addEventListener("click", () => {
  send({ type: "cancel" });
  setRunning(false);
  statusLine.textContent = "";
});

// ---- engine panel ----

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function renderEngineStatus(status: EngineStatus): void {
  const node = byId("engine-status");
  if (status.state === "stopped") {
    node.textContent = "stopped";
  } else if (status.state === "running-managed") {
    node.textContent = `running (managed): ${status.endpoint ?? ""}`;
  } else {
    node.textContent = `running (external, adopted): ${status.endpoint ?? ""}`;
  }
  (byId<HTMLButtonElement>("engine-start")).disabled = status.state !== "stopped";
  (byId<HTMLButtonElement>("engine-stop")).disabled = status.state !== "running-managed";
  (byId<HTMLButtonElement>("engine-restart")).disabled = status.state === "running-external";
}

function renderEngineModels(models: ModelEntry[]): void {
  const select = byId<HTMLSelectElement>("engine-model");
  const current = select.value;
  select.replaceChildren();
  for (const m of models) {
    const option = document.createElement("option");
    option.value = m.alias;
    option.textContent = `${m.present ? "● " : "○ "}${m.alias} (~${m.approxSizeGB} GB)`;
    select.appendChild(option);
  }
  if (current) select.value = current;
}

function appendEngineLog(text: string): void {
  const log = byId("engine-log");
  log.textContent = `${log.textContent ?? ""}${text}\n`;
  log.scrollTop = log.scrollHeight;
}

function setupEnginePanel(): void {
  const panel = byId("engine-panel");
  byId("engine-toggle").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      send({ type: "engine", action: "list" });
      send({ type: "engine", action: "status" });
    }
  });
  const selectedModel = (): string | undefined => byId<HTMLSelectElement>("engine-model").value || undefined;
  byId("engine-start").addEventListener("click", () => send({ type: "engine", action: "up", alias: selectedModel() }));
  byId("engine-stop").addEventListener("click", () => send({ type: "engine", action: "down" }));
  byId("engine-restart").addEventListener("click", () => send({ type: "engine", action: "restart", alias: selectedModel() }));
  byId("engine-pull").addEventListener("click", () => { const a = selectedModel(); if (a) send({ type: "engine", action: "pull", alias: a }); });

  const setKnob = (key: string, value: string): void => send({ type: "engineSet", key, value });
  byId("knob-ctx").addEventListener("change", (e) => setKnob("ctx", (e.target as HTMLInputElement).value));
  byId("knob-moe").addEventListener("change", (e) => setKnob("n-cpu-moe", (e.target as HTMLInputElement).value));
  byId("knob-mtp").addEventListener("change", (e) => setKnob("mtp", (e.target as HTMLSelectElement).value));
  byId("knob-mmproj").addEventListener("change", (e) => setKnob("mmproj", (e.target as HTMLSelectElement).value));
  byId("knob-host").addEventListener("change", (e) => setKnob("host", (e.target as HTMLSelectElement).value));
}

setupEnginePanel();
connect();
