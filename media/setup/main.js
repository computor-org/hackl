(function () {
  const vscode = acquireVsCodeApi();
  let selectedCodexModel = "";
  const hintDismiss = document.getElementById("hint-dismiss");

  function setStatus(state, text) {
    const el = document.getElementById("status");
    el.className = "status status-" + state;
    el.querySelector(".pill").textContent = state === "ok" ? "connected" : state === "none" ? "no server" : "probing";
    document.getElementById("status-text").textContent = text;
  }

  document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
  for (const btn of document.querySelectorAll("button[data-set]")) {
    btn.addEventListener("click", () => vscode.postMessage({ type: "setEndpoint", endpoint: btn.dataset.set }));
  }
  for (const btn of document.querySelectorAll("button[data-doc]")) {
    btn.addEventListener("click", () => vscode.postMessage({ type: "openDoc", doc: btn.dataset.doc }));
  }
  for (const a of document.querySelectorAll("[data-link]")) {
    a.addEventListener("click", (e) => { e.preventDefault(); vscode.postMessage({ type: "openLink", href: a.dataset.link }); });
  }
  for (const id of ["codex-recheck", "codex-recheck-2", "codex-recheck-3"]) {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
  }
  const runLogin = document.getElementById("codex-run-login");
  if (runLogin) runLogin.addEventListener("click", () => vscode.postMessage({ type: "codexLogin" }));
  const useCodex = document.getElementById("codex-use");
  if (useCodex) {
    useCodex.addEventListener("click", () => {
      if (selectedCodexModel) vscode.postMessage({ type: "useCodex", model: selectedCodexModel });
    });
  }
  if (hintDismiss) {
    hintDismiss.addEventListener("change", () => vscode.postMessage({ type: "setHintDismissed", value: hintDismiss.checked }));
  }

  function focusProfile(profile) {
    document.getElementById("profile").textContent = profile;
    if (profile === "lmstudio" || profile === "llamacpp" || profile === "ollama") {
      const target = document.getElementById(profile);
      if (target) target.open = true;
    }
  }

  function renderCodex(codex) {
    const state = document.getElementById("codex-state");
    const text = document.getElementById("codex-state-text");
    const install = document.getElementById("codex-install");
    const login = document.getElementById("codex-login");
    const ready = document.getElementById("codex-ready");
    install.hidden = true;
    login.hidden = true;
    ready.hidden = true;
    if (!codex || !codex.available) {
      state.className = "codex-state codex-state-missing";
      state.querySelector(".codex-pill").textContent = "missing";
      text.textContent = "Codex CLI not found on PATH.";
      install.hidden = false;
      return;
    }
    if (codex.authMode === "none") {
      state.className = "codex-state codex-state-login";
      state.querySelector(".codex-pill").textContent = "login";
      text.textContent = "Codex CLI " + (codex.version || "") + " installed but not logged in.";
      login.hidden = false;
      return;
    }
    state.className = "codex-state codex-state-ready";
    state.querySelector(".codex-pill").textContent = "ready";
    text.textContent = "Codex " + (codex.version || "") + " · " + codex.authMode + " auth";
    ready.hidden = false;
    renderModelList(codex.models || []);
  }

  function renderModelList(models) {
    const list = document.getElementById("codex-models");
    const useBtn = document.getElementById("codex-use");
    list.innerHTML = "";
    if (!models.length) {
      const li = document.createElement("li");
      li.textContent = "No models advertised by codex; defaults will be used.";
      list.appendChild(li);
      useBtn.disabled = true;
      return;
    }
    if (!models.includes(selectedCodexModel)) selectedCodexModel = models[0];
    for (const model of models) {
      const li = document.createElement("li");
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "codex-model";
      input.value = model;
      input.checked = model === selectedCodexModel;
      input.addEventListener("change", () => {
        selectedCodexModel = model;
        useBtn.disabled = false;
      });
      const span = document.createElement("span");
      span.textContent = model;
      label.appendChild(input);
      label.appendChild(span);
      li.appendChild(label);
      list.appendChild(li);
    }
    useBtn.disabled = !selectedCodexModel;
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "status") {
      if (m.connected) {
        const ctx = m.ctx ? " · " + Math.floor(m.ctx / 1024) + "k ctx" : "";
        setStatus("ok", m.endpoint + " · " + (m.model || "model") + ctx);
      } else if (m.codex && m.codex.available && m.codex.authMode !== "none") {
        setStatus("ok", "Codex ready · " + (m.codex.version || ""));
      } else {
        setStatus("none", "No model backend detected.");
      }
      if (m.profile) focusProfile(m.profile);
      renderCodex(m.codex);
      if (hintDismiss && typeof m.hintDismissed === "boolean") {
        hintDismiss.checked = m.hintDismissed;
      }
    }
  });
  vscode.postMessage({ type: "ready" });
}());
