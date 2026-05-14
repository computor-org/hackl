(function () {
  const vscode = acquireVsCodeApi();
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
  function focusProfile(profile) {
    document.getElementById("profile").textContent = profile;
    if (profile === "lmstudio" || profile === "llamacpp" || profile === "ollama") {
      const target = document.getElementById(profile);
      if (target) target.open = true;
    }
  }
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "status") {
      if (m.connected) {
        const ctx = m.ctx ? " · " + Math.floor(m.ctx / 1024) + "k ctx" : "";
        setStatus("ok", m.endpoint + " · " + (m.model || "model") + ctx);
      } else {
        setStatus("none", "No local server detected on any candidate endpoint.");
      }
      if (m.profile) focusProfile(m.profile);
    }
  });
  vscode.postMessage({ type: "ready" });
}());
