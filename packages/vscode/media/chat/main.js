(function () {
  const vscode = acquireVsCodeApi();

  // Mirror of src/modelLabel.ts: compact a model id for display only.
  function shortModelLabel(id) {
    if (!id) return id;
    const noVendor = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
    const noCtx = noVendor.split("@")[0];
    const colon = noCtx.indexOf(":");
    if (colon === -1) return noCtx;
    const name = noCtx.slice(0, colon);
    const params = noCtx.slice(colon + 1);
    const hasDescriptor = name.split("-").slice(1).some((seg) => /[a-zA-Z]/.test(seg));
    if (hasDescriptor) return name;
    const size = params.split("-").find((seg) => /^\d+(\.\d+)?b$/i.test(seg));
    return size ? name + ":" + size : name;
  }
  const form = document.getElementById("form");
  const prompt = document.getElementById("prompt");
  const thread = document.getElementById("thread");
  const send = document.getElementById("send");
  const clear = document.getElementById("clear");
  const contextMeter = document.getElementById("context-meter");
  const endpointStatus = document.getElementById("endpoint-status");
  const emptyState = document.getElementById("empty-state");
  const reasoningToggle = document.getElementById("reasoning-toggle");
  const basketSection = document.getElementById("basket");
  const basketList = document.getElementById("basket-list");
  const basketCount = document.getElementById("basket-count");
  const basketAdd = document.getElementById("basket-add");
  const basketClear = document.getElementById("basket-clear");
  const attachButton = document.getElementById("attach");
  const modeButton = document.getElementById("mode-button");
  const modeMenu = document.getElementById("mode-menu");
  const modeLabel = document.getElementById("mode-label");
  const modelButton = document.getElementById("model-button");
  const modelMenu = document.getElementById("model-menu");
  const modelLabel = document.getElementById("model-label");
  let backends = null;
  // html: false is the XSS contract for every innerHTML = md.render(...) sink below.
  // Do not enable html or switch sinks to direct string assignment.
  const md = window.markdownit({ html: false, linkify: true, breaks: false });
  let statusEntry;
  let assistantDraft;
  let isBusy = false;
  let selectedMode = "agent";
  const savedState = vscode.getState();
  if (savedState && typeof savedState.selectedMode === "string") {
    selectedMode = normalizeMode(savedState.selectedMode);
  }
  let annotationContextAvailable = false;
  const pendingQueue = [];
  const annotationContextPrompt = "Address the attached annotation comments.";

  installMath(md);
  autoResize();
  updateEmptyState();
  vscode.postMessage({ type: "ready" });
  syncModeSelection();
  focusPrompt();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = prompt.value.trim();
    const promptText = text || (annotationContextAvailable ? annotationContextPrompt : "");
    if (!promptText) return;
    const entry = appendUser(promptText);
    prompt.value = "";
    autoResize();
    focusPrompt();
    if (isBusy) {
      const item = { text: promptText, mode: selectedMode, entry };
      pendingQueue.push(item);
      markQueued(entry, true, () => removeQueuedItem(item));
      updateSendState();
      return;
    }
    sendPrompt(promptText, selectedMode);
  });

  send.addEventListener("click", (event) => {
    if (!isBusy) return;
    event.preventDefault();
    stopRun();
  });

  prompt.addEventListener("input", () => {
    autoResize();
    updateSendState();
  });

  prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (isBusy) return;
      form.requestSubmit();
      return;
    }
    if (event.key === "Escape" && isBusy) {
      event.preventDefault();
      stopRun();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isBusy && event.target !== prompt) {
      event.preventDefault();
      stopRun();
    }
  });

  clear.addEventListener("click", () => {
    vscode.postMessage({ type: "clear" });
  });

  if (reasoningToggle) {
    reasoningToggle.addEventListener("click", () => {
      const next = reasoningToggle.getAttribute("aria-pressed") !== "true";
      reasoningToggle.setAttribute("aria-pressed", String(next));
      vscode.postMessage({ type: "setThinking", value: next });
      focusPrompt();
    });
  }

  if (attachButton) {
    attachButton.addEventListener("click", () => {
      vscode.postMessage({ type: "runCommand", value: "hackl.attachContext" });
      focusPrompt();
    });
  }

  if (modelButton && modelMenu) {
    modelButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = modelMenu.hidden;
      modelMenu.hidden = !open;
      modelButton.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (event) => {
      if (modelMenu.hidden) return;
      const target = event.target;
      if (target instanceof Node && (modelButton.contains(target) || modelMenu.contains(target))) return;
      modelMenu.hidden = true;
      modelButton.setAttribute("aria-expanded", "false");
    });
  }

  function renderModelMenu() {
    if (!modelMenu || !backends) return;
    modelMenu.innerHTML = "";
    const current = backends.current || {};
    function addHeader(text) {
      const h = document.createElement("div");
      h.className = "mode-option";
      h.setAttribute("role", "presentation");
      h.setAttribute("disabled", "true");
      h.style.opacity = "0.7";
      h.style.fontSize = "10px";
      h.style.textTransform = "uppercase";
      h.style.letterSpacing = "0.5px";
      h.textContent = text;
      modelMenu.appendChild(h);
    }
    function addOption(label, kind, model, enabled, title) {
      const btn = document.createElement("button");
      btn.className = "mode-option";
      btn.type = "button";
      btn.setAttribute("role", "option");
      btn.setAttribute("data-kind", kind);
      btn.setAttribute("data-model", model || "");
      btn.textContent = label;
      if (title) btn.title = title;
      const selected = current.kind === kind && (current.model || "") === (model || "");
      btn.setAttribute("aria-selected", String(selected));
      if (!enabled) btn.setAttribute("disabled", "true");
      btn.addEventListener("click", () => {
        if (!enabled) return;
        vscode.postMessage({ type: "setBackend", backendKind: kind, model: model });
        modelMenu.hidden = true;
        modelButton.setAttribute("aria-expanded", "false");
        focusPrompt();
      });
      modelMenu.appendChild(btn);
    }
    addHeader("Local");
    if (backends.local && backends.local.available) {
      const models = (backends.local.models && backends.local.models.length)
        ? backends.local.models
        : [backends.local.model || ""];
      for (const model of models) {
        addOption(model ? shortModelLabel(model) : "Auto", "local", model || "", true, model || backends.local.endpoint || "");
      }
    } else {
      addOption("Not reachable", "local", "", false, "Start a local server first.");
    }
    addHeader("Codex");
    if (backends.codex && backends.codex.available && !backends.codex.needsLogin) {
      for (const model of backends.codex.models) {
        addOption(shortModelLabel(model), "codex", model, true, "codex app-server");
      }
    } else if (backends.codex && backends.codex.available && backends.codex.needsLogin) {
      addOption("Run codex login", "codex", "", false, "Run `codex login` in a terminal to enable.");
    } else {
      addOption("Not installed", "codex", "", false, "Install the Codex CLI to enable.");
    }
    updateModelLabel();
  }

  function updateModelLabel() {
    if (!modelLabel || !backends) return;
    const c = backends.current || {};
    if (c.kind === "codex") {
      modelLabel.textContent = "Codex · " + shortModelLabel(c.model || "");
    } else if (c.kind === "local" && backends.local && backends.local.model) {
      modelLabel.textContent = shortModelLabel(backends.local.model);
    } else {
      modelLabel.textContent = "Local";
    }
  }

  function updateComboStrip() {
    if (send) {
      const tier = { ask: "read", edit: "read+edit", work: "read+edit+search", agent: "read+edit+search+cmd", yolo: "DANGER: any command, no approval" }[selectedMode] || selectedMode;
      send.title = "Send · " + selectedMode + " (" + tier + ")";
    }
  }

  const annotationsDiscard = document.getElementById("annotations-discard");
  if (annotationsDiscard) {
    annotationsDiscard.addEventListener("click", () => {
      vscode.postMessage({ type: "runCommand", value: "hackl.discardLastAnnotations" });
      annotationsDiscard.hidden = true;
    });
  }

  if (basketAdd) {
    basketAdd.addEventListener("click", () => {
      vscode.postMessage({ type: "runCommand", value: "hackl.attachContext" });
    });
  }
  if (basketClear) {
    basketClear.addEventListener("click", () => {
      vscode.postMessage({ type: "clearBasket" });
    });
  }

  if (modeButton && modeMenu) {
    modeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = modeMenu.hidden;
      modeMenu.hidden = !open;
      modeButton.setAttribute("aria-expanded", String(open));
    });
    modeMenu.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const option = target.closest(".mode-option");
      if (!option || option.hasAttribute("disabled")) return;
      const value = option.getAttribute("data-value") || "ask";
      selectedMode = normalizeMode(value);
      vscode.setState({ ...(vscode.getState() || {}), selectedMode });
      syncModeSelection();
      modeMenu.hidden = true;
      modeButton.setAttribute("aria-expanded", "false");
      focusPrompt();
    });
    document.addEventListener("click", (event) => {
      if (modeMenu.hidden) return;
      const target = event.target;
      if (target instanceof Node && (modeButton.contains(target) || modeMenu.contains(target))) return;
      modeMenu.hidden = true;
      modeButton.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modeMenu.hidden) {
        event.preventDefault();
        modeMenu.hidden = true;
        modeButton.setAttribute("aria-expanded", "false");
        focusPrompt();
      }
    });
  }

  if (emptyState) {
    emptyState.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const chip = target.closest(".chip");
      if (!chip) return;
      const suggestion = chip.getAttribute("data-suggest") || chip.textContent || "";
      prompt.value = suggestion;
      autoResize();
      updateSendState();
      prompt.focus();
    });
  }

  function autoResize() {
    prompt.style.height = "auto";
    const next = Math.min(prompt.scrollHeight, 200);
    prompt.style.height = next + "px";
  }

  function updateEmptyState() {
    if (!emptyState) return;
    const hasEntries = thread.querySelector(".entry");
    emptyState.classList.toggle("hidden", Boolean(hasEntries));
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "history") renderHistory(message.entries || []);
    if (message.type === "cleared") clearThread();
    if (message.type === "status") showStatus(message.text);
    if (message.type === "metrics") updateMeter(message.inputTokens, message.maxContextTokens);
    if (message.type === "state") applyState(message);
    if (message.type === "basket") renderBasket(message.targets || []);
    if (message.type === "userPrompt") appendUser(message.text || "");
    if (message.type === "setPromptText" && prompt) {
      prompt.value = message.text || "";
      prompt.focus();
      autoResize();
    }
    if (message.type === "focusInput") {
      requestAnimationFrame(() => {
        prompt.focus();
        const end = prompt.value.length;
        prompt.setSelectionRange(end, end);
      });
    }
    if (message.type === "approvalRequested") appendApproval(message);
    if (message.type === "assistantDelta") appendAssistantDelta(message.channel, message.text);
    if (message.type === "answer") {
      clearStatus();
      finishAssistant(message.text, message.reasoning || "");
      if (Array.isArray(message.annotations) && message.annotations.length > 0) {
        appendAnnotations(message.annotations);
        const discard = document.getElementById("annotations-discard");
        if (discard) discard.hidden = false;
      }
      setBusy(false);
      drainQueue();
    }
    if (message.type === "error") {
      clearStatus();
      appendError(message.text);
      setBusy(false);
      drainQueue();
    }
  });

  function sendPrompt(text, mode) {
    setBusy(true);
    vscode.postMessage({
      type: "prompt",
      prompt: text,
      mode: normalizeMode(mode),
    });
  }

  function normalizeMode(mode) {
    return ["edit", "work", "agent", "yolo"].includes(mode) ? mode : "ask";
  }

  function syncModeSelection() {
    if (modeLabel) {
      modeLabel.textContent = selectedMode.charAt(0).toUpperCase() + selectedMode.slice(1);
    }
    if (modeMenu) {
      modeMenu.querySelectorAll(".mode-option").forEach((option) => {
        option.setAttribute("aria-selected", String(option.getAttribute("data-value") === selectedMode));
      });
    }
    updateComboStrip();
  }

  function updateAnnotationContextAvailable(targets) {
    annotationContextAvailable = targets.some(hasAnnotationNote);
    updateSendState();
  }

  function hasAnnotationNote(target) {
    return Boolean(target && target.metadata && target.metadata.note);
  }

  function renderBasket(targets) {
    if (!basketSection || !basketList) return;
    basketList.innerHTML = "";
    const hasTargets = targets.length > 0;
    basketSection.hidden = !hasTargets;
    if (basketCount) basketCount.textContent = hasTargets ? String(targets.length) : "";
    updateAnnotationContextAvailable(targets);
    for (const target of targets) {
      const item = document.createElement("li");
      item.className = "basket-item";
      const kind = document.createElement("span");
      kind.className = "basket-item-kind";
      kind.textContent = kindShort(target.kind);
      const label = document.createElement("button");
      label.type = "button";
      label.className = "basket-item-label";
      label.textContent = describe(target);
      label.title = describe(target) + " - click to reveal";
      label.addEventListener("click", () => {
        vscode.postMessage({ type: "revealTarget", targetId: target.id });
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "basket-remove";
      remove.title = "Remove";
      remove.setAttribute("aria-label", "Remove target");
      const icon = document.createElement("span");
      icon.className = "codicon codicon-close";
      icon.setAttribute("aria-hidden", "true");
      remove.appendChild(icon);
      remove.addEventListener("click", () => {
        vscode.postMessage({ type: "removeTarget", targetId: target.id });
      });
      item.appendChild(kind);
      item.appendChild(label);
      item.appendChild(remove);
      basketList.appendChild(item);
    }
  }

  function kindShort(kind) {
    if (kind === "source-range") return "src";
    if (kind === "markdown-section") return "md";
    if (kind === "staged-changes") return "staged";
    if (kind === "commit") return "commit";
    return kind;
  }

  function describe(target) {
    if (target.kind === "source-range") return target.relativePath + ":" + target.startLine + "-" + target.endLine;
    if (target.kind === "markdown-section") {
      const heading = target.headingPath && target.headingPath.length ? " # " + target.headingPath.join(" › ") : "";
      return target.relativePath + ":" + target.startLine + "-" + target.endLine + heading;
    }
    if (target.kind === "staged-changes") {
      return "staged diff: " + (target.files ? target.files.length : 0) + " files" + (target.diffTruncated ? " (truncated)" : "");
    }
    if (target.kind === "commit") {
      return "commit " + String(target.sha || "").slice(0, 7) + " " + (target.subject || "") + (target.diffTruncated ? " (diff truncated)" : "");
    }
    return target.kind;
  }

  function appendAnnotations(annotations) {
    const list = document.createElement("ul");
    list.className = "annotation-list";
    for (const annotation of annotations) {
      const item = document.createElement("li");
      item.className = "annotation-item";
      const head = document.createElement("div");
      head.className = "annotation-item-head annotation-sev-" + annotation.severity;
      head.textContent = annotation.severity + " · " + uriBasename(annotation.uri) + ":" + annotation.startLine;
      const body = document.createElement("div");
      body.textContent = annotation.message;
      item.appendChild(head);
      item.appendChild(body);
      if (annotation.rationale) {
        const rationale = document.createElement("div");
        rationale.style.color = "var(--vscode-descriptionForeground)";
        rationale.style.marginTop = "2px";
        rationale.style.fontSize = "11px";
        rationale.textContent = annotation.rationale;
        item.appendChild(rationale);
      }
      list.appendChild(item);
    }
    const wrap = document.createElement("section");
    wrap.className = "entry assistant";
    const label = document.createElement("div");
    label.className = "role";
    label.textContent = "Hackl · annotations";
    wrap.appendChild(label);
    wrap.appendChild(list);
    thread.appendChild(wrap);
    scrollThreadToBottom();
  }

  function uriBasename(uri) {
    if (!uri) return "";
    try {
      const path = uri.split(/[?#]/)[0];
      const parts = path.split("/");
      return parts[parts.length - 1] || uri;
    } catch {
      return uri;
    }
  }

  function drainQueue() {
    if (isBusy) return;
    const next = pendingQueue.shift();
    if (!next) {
      focusPrompt();
      return;
    }
    markQueued(next.entry, false);
    sendPrompt(next.text, next.mode);
  }

  function markQueued(entry, queued, onRemove) {
    if (!entry) return;
    entry.classList.toggle("queued", queued);
    const existing = entry.querySelector(".queued-remove");
    if (queued && !existing && typeof onRemove === "function") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "queued-remove";
      button.title = "Remove from queue";
      button.setAttribute("aria-label", "Remove from queue");
      const icon = document.createElement("span");
      icon.className = "codicon codicon-close";
      icon.setAttribute("aria-hidden", "true");
      button.appendChild(icon);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onRemove();
      });
      const label = entry.querySelector(".role");
      if (label) label.appendChild(button);
    }
    if (!queued && existing) {
      existing.remove();
    }
  }

  function removeQueuedItem(item) {
    const index = pendingQueue.indexOf(item);
    if (index >= 0) pendingQueue.splice(index, 1);
    if (item.entry) item.entry.remove();
    updateEmptyState();
  }

  function stopRun() {
    if (!isBusy) return;
    vscode.postMessage({ type: "cancel" });
    for (const item of pendingQueue.splice(0)) {
      if (item.entry) item.entry.remove();
    }
    if (assistantDraft) {
      assistantDraft.element.remove();
      assistantDraft = undefined;
    }
    clearStatus();
    setBusy(false);
    updateEmptyState();
    focusPrompt();
  }

  function focusPrompt() {
    requestAnimationFrame(() => prompt.focus());
  }

  updateComboStrip();

  function applyState(message) {
    if (reasoningToggle && typeof message.enableThinking === "boolean") {
      reasoningToggle.setAttribute("aria-pressed", String(message.enableThinking));
    }
    if (message.backends) {
      backends = message.backends;
      renderModelMenu();
    }
    updateEndpointStatus(message);
  }

  function updateEndpointStatus(message) {
    if (!endpointStatus) return;
    if (message.connected === false && !message.endpointApprovalRequired) {
      endpointStatus.textContent = "";
      endpointStatus.title = "";
      return;
    }
    if (!message.endpoint) return;
    const endpoint = endpointLabel(message.endpoint);
    const model = message.model || (message.endpointApprovalRequired ? "approval required" : "");
    const text = model ? endpoint + " · " + model : endpoint;
    endpointStatus.textContent = text;
    endpointStatus.title = message.endpointApprovalRequired
      ? "Configured non-local endpoint. Hackl will ask before sending prompts or selected context."
      : message.model
        ? "OpenAI-compatible endpoint and model: " + text
        : "OpenAI-compatible endpoint: " + endpoint;
  }

  function endpointLabel(endpoint) {
    try {
      return new URL(endpoint).host || endpoint;
    } catch {
      return endpoint;
    }
  }

  function updateSendState() {
    if (isBusy) {
      send.disabled = false;
      send.classList.add("stop");
      send.title = "Stop (Esc)";
      send.setAttribute("aria-label", "Stop");
      setSendIcon("debug-stop");
      return;
    }
    send.classList.remove("stop");
    setSendIcon("arrow-up");
    send.title = "Send (Enter)";
    send.setAttribute("aria-label", "Send");
    const hasText = prompt.value.trim().length > 0;
    send.disabled = !(hasText || annotationContextAvailable);
  }

  function setSendIcon(name) {
    const icon = send.querySelector(".codicon");
    if (!icon) return;
    icon.className = "codicon codicon-" + name;
  }

  function renderHistory(entries) {
    clearThread();
    for (const entry of entries) {
      if (entry.role === "user") appendUser(entry.content);
      if (entry.role === "assistant") appendAssistant(entry.content);
    }
  }

  function appendUser(text) {
    return append("entry user", "You", text, false);
  }

  function appendAssistant(text) {
    const split = splitReasoning(text || "");
    appendAssistantEntry(split.answer, split.reasoning);
  }

  function appendError(text) {
    append("entry error", "Error", text, false);
  }

  function appendApproval(message) {
    const element = document.createElement("section");
    const label = document.createElement("div");
    const body = document.createElement("div");
    const title = document.createElement("div");
    const detail = document.createElement("div");
    const actions = document.createElement("div");
    const approve = document.createElement("button");
    const deny = document.createElement("button");
    element.className = "entry approval";
    label.className = "role";
    label.textContent = "Approval";
    body.className = "body";
    title.className = "approval-title";
    title.textContent = message.title || "Approve action?";
    detail.className = "approval-detail";
    detail.textContent = message.detail || "";
    actions.className = "approval-actions";
    approve.type = "button";
    deny.type = "button";
    approve.textContent = message.approveLabel || "Approve";
    deny.textContent = message.denyLabel || "Deny";
    approve.addEventListener("click", () => answerApproval(message.id, true, element));
    deny.addEventListener("click", () => answerApproval(message.id, false, element));
    actions.appendChild(approve);
    actions.appendChild(deny);
    body.appendChild(title);
    body.appendChild(detail);
    body.appendChild(actions);
    element.appendChild(label);
    element.appendChild(body);
    thread.appendChild(element);
    updateEmptyState();
    scrollThreadToBottom();
  }

  function answerApproval(id, approved, element) {
    vscode.postMessage({ type: "approvalResponse", approvalId: id, approved });
    element.querySelectorAll("button").forEach((button) => button.disabled = true);
  }

  function append(className, role, text, markdown) {
    const element = document.createElement("section");
    const label = document.createElement("div");
    const body = document.createElement("div");
    element.className = className;
    label.className = "role";
    label.textContent = role;
    body.className = "body";
    if (markdown) {
      body.innerHTML = md.render(text || "");
    } else {
      body.textContent = text || "";
    }
    element.appendChild(label);
    element.appendChild(body);
    thread.appendChild(element);
    updateEmptyState();
    scrollThreadToBottom();
    return element;
  }

  function appendAssistantEntry(answer, reasoning) {
    const entry = createAssistantEntry();
    renderAssistantEntry(entry, answer, reasoning);
    thread.appendChild(entry.element);
    updateEmptyState();
    scrollThreadToBottom();
    return entry;
  }

  function appendAssistantDelta(channel, text) {
    if (!assistantDraft) {
      assistantDraft = createAssistantEntry();
      thread.appendChild(assistantDraft.element);
      updateEmptyState();
    }
    if (channel === "reasoning") {
      assistantDraft.reasoning += text || "";
    } else {
      assistantDraft.answer += text || "";
    }
    renderAssistantEntry(assistantDraft, assistantDraft.answer, assistantDraft.reasoning);
    scrollThreadToBottom();
  }

  function finishAssistant(answer, reasoning) {
    if (!assistantDraft) {
      appendAssistantEntry(answer || "", reasoning || "");
      return;
    }
    renderAssistantEntry(assistantDraft, answer || assistantDraft.answer, reasoning || assistantDraft.reasoning);
    scrollThreadToBottom();
    assistantDraft = undefined;
  }

  function createAssistantEntry() {
    const element = document.createElement("section");
    const label = document.createElement("div");
    const reasoning = document.createElement("div");
    const reasoningToggle = document.createElement("button");
    const reasoningIcon = document.createElement("span");
    const reasoningLabel = document.createElement("span");
    const reasoningText = document.createElement("div");
    const body = document.createElement("div");
    element.className = "entry assistant";
    label.className = "role";
    label.textContent = "Hackl";
    reasoning.className = "reasoning";
    reasoningToggle.className = "reasoning-toggle";
    reasoningToggle.type = "button";
    reasoningToggle.title = "Expand reasoning";
    reasoningIcon.className = "codicon codicon-chevron-right";
    reasoningLabel.textContent = "reasoning";
    reasoningText.className = "reasoning-text";
    reasoningToggle.appendChild(reasoningIcon);
    reasoningToggle.appendChild(reasoningLabel);
    reasoning.appendChild(reasoningToggle);
    reasoning.appendChild(reasoningText);
    reasoningToggle.addEventListener("click", () => {
      const expanded = reasoning.classList.toggle("expanded");
      reasoningToggle.title = expanded ? "Collapse reasoning" : "Expand reasoning";
    });
    body.className = "body";
    element.appendChild(label);
    element.appendChild(reasoning);
    element.appendChild(body);
    return { element, reasoningElement: reasoning, reasoningText, body, reasoning: "", answer: "" };
  }

  function renderAssistantEntry(entry, answer, reasoning) {
    entry.reasoning = reasoning || "";
    entry.answer = answer || "";
    entry.reasoningText.textContent = entry.reasoning;
    entry.reasoningElement.hidden = !entry.reasoning;
    entry.body.innerHTML = md.render(entry.answer || "");
  }

  function splitReasoning(text) {
    let answer = "";
    const reasoning = [];
    let position = 0;
    while (position < text.length) {
      const start = text.indexOf("<think>", position);
      if (start < 0) {
        answer += text.slice(position);
        break;
      }
      answer += text.slice(position, start);
      const bodyStart = start + "<think>".length;
      const end = text.indexOf("</think>", bodyStart);
      if (end < 0) {
        reasoning.push(text.slice(bodyStart));
        break;
      }
      reasoning.push(text.slice(bodyStart, end));
      position = end + "</think>".length;
    }
    return { answer: answer.trimStart(), reasoning: reasoning.join("\\n\\n").trim() };
  }

  function showStatus(text) {
    clearStatus();
    statusEntry = document.createElement("section");
    statusEntry.className = "entry status";
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = text;
    statusEntry.appendChild(body);
    thread.appendChild(statusEntry);
    scrollThreadToBottom();
  }

  function clearStatus() {
    if (statusEntry) {
      statusEntry.remove();
      statusEntry = undefined;
    }
  }

  function clearThread() {
    const entries = thread.querySelectorAll(".entry");
    entries.forEach((node) => node.remove());
    assistantDraft = undefined;
    pendingQueue.length = 0;
    clearStatus();
    setBusy(false);
    updateEmptyState();
    focusPrompt();
  }

  function updateMeter(inputTokens, maxContextTokens) {
    if (!contextMeter || !inputTokens || !maxContextTokens) return;
    const percent = Math.round((inputTokens / maxContextTokens) * 100);
    contextMeter.textContent = compactTokens(inputTokens) + " / " + compactTokens(maxContextTokens);
    contextMeter.title = "~" + inputTokens.toLocaleString() + " of " + maxContextTokens.toLocaleString() + " tokens (" + percent + "%)";
  }

  function compactTokens(n) {
    if (n >= 1000) {
      const k = n / 1000;
      return (k >= 10 ? Math.round(k) : Math.round(k * 10) / 10) + "k";
    }
    return String(n);
  }

  function scrollThreadToBottom() {
    requestAnimationFrame(() => {
      thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
    });
  }

  function setBusy(busy) {
    isBusy = busy;
    clear.disabled = busy;
    updateSendState();
  }

  function installMath(markdown) {
    markdown.inline.ruler.before("escape", "math_inline", mathInline);
    markdown.block.ruler.before("fence", "math_block", mathBlock, { alt: ["paragraph", "reference", "blockquote"] });
    markdown.renderer.rules.math_inline = (tokens, idx) => renderMath(tokens[idx].content, false);
    markdown.renderer.rules.math_block = (tokens, idx) => renderMath(tokens[idx].content, true);
  }

  function mathInline(state, silent) {
    if (state.src.charCodeAt(state.pos) !== 0x24) return false;
    const start = state.pos + 1;
    const end = state.src.indexOf("$", start);
    if (end < 0 || end === start) return false;
    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = state.src.slice(start, end);
    }
    state.pos = end + 1;
    return true;
  }

  function mathBlock(state, startLine, endLine, silent) {
    let position = state.bMarks[startLine] + state.tShift[startLine];
    let maximum = state.eMarks[startLine];
    if (state.src.slice(position, position + 2) !== "$$") return false;
    let firstLine = state.src.slice(position + 2, maximum);
    if (firstLine.trim().endsWith("$$")) {
      firstLine = firstLine.trim().slice(0, -2);
      return pushMathBlock(state, startLine, startLine + 1, firstLine, silent);
    }
    const lines = [firstLine];
    for (let nextLine = startLine + 1; nextLine < endLine; nextLine++) {
      position = state.bMarks[nextLine] + state.tShift[nextLine];
      maximum = state.eMarks[nextLine];
      const line = state.src.slice(position, maximum);
      if (line.trim() === "$$") {
        return pushMathBlock(state, startLine, nextLine + 1, lines.join("\\n"), silent);
      }
      lines.push(line);
    }
    return false;
  }

  function pushMathBlock(state, startLine, nextLine, content, silent) {
    if (!silent) {
      const token = state.push("math_block", "math", 0);
      token.block = true;
      token.content = content.trim();
      token.map = [startLine, nextLine];
    }
    state.line = nextLine;
    return true;
  }

  function renderMath(source, displayMode) {
    return window.katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false
    });
  }
}());
