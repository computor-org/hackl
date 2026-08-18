import * as vscode from "vscode";
import { AutocompleteConfig, readHacklConfig } from "./config";
import { resolveAutocompleteTarget } from "./autocompleteTarget";
import { FimDetectionResult, FimSupport, detectFim } from "./fimDetect";
import { requestFim } from "./fimClient";
import { shortModelLabel } from "@hackl/core";
import { ensureEngineReady } from "./enginePanel";

const STATUS_PRIORITY = 50;
const COMMAND_TOGGLE = "hackl.toggleAutocomplete";
const COMMAND_STATUS_CLICK = "hackl.autocompleteStatusClick";
const PREFIX_LINE_WINDOW = 120;
const SUFFIX_LINE_WINDOW = 80;

type ReadyRuntime = {
  kind: "ready";
  endpoint: string;
  root: string;
  model?: string;
  detection: FimDetectionResult;
};

type SupportedRuntime = Omit<ReadyRuntime, "detection"> & {
  detection: FimSupport;
};

type AutocompleteRuntime =
  | ReadyRuntime
  | {
      kind: "unavailable";
      reason: string;
    };

export function registerAutocomplete(context: vscode.ExtensionContext): void {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, STATUS_PRIORITY);
  status.command = COMMAND_STATUS_CLICK;
  status.show();
  context.subscriptions.push(status);

  new AutocompleteController(context, status).register();
}

class AutocompleteController {
  private resolved: AutocompleteRuntime | undefined;
  private resolving: Promise<AutocompleteRuntime | undefined> | undefined;
  private pendingTimer: ReturnType<typeof setTimeout> | undefined;
  private inflight: AbortController | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly status: vscode.StatusBarItem,
  ) {}

  register(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_TOGGLE, () => this.toggle()),
      vscode.commands.registerCommand(COMMAND_STATUS_CLICK, () => this.statusClick()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("hackl.autocomplete")
          || event.affectsConfiguration("hackl.endpoint")
          || event.affectsConfiguration("hackl.model")) {
          this.invalidate();
          void this.refresh();
        }
      }),
      vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, this.provider()),
    );
    // Keep activation lightweight; the first completion request resolves the
    // target and starts the managed engine when no external endpoint is set.
    this.updateStatus();
  }

  private async toggle(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("hackl");
    const current = cfg.get<boolean>("autocomplete.enabled", true);
    await cfg.update("autocomplete.enabled", !current, vscode.ConfigurationTarget.Global);
    if (!current) {
      void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    }
  }

  // Status-bar click. Unlike the palette toggle, this never disables a broken
  // endpoint: clicking a warning state retries resolution instead, so a user
  // reacting to "no suggestions" does not silently turn autocomplete off.
  private async statusClick(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("hackl");
    if (!cfg.get<boolean>("autocomplete.enabled", true)) {
      await cfg.update("autocomplete.enabled", true, vscode.ConfigurationTarget.Global);
      void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
      return;
    }
    if (!isSupportedRuntime(this.resolved)) {
      this.invalidate();
      await this.refresh();
      void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
      return;
    }
    await cfg.update("autocomplete.enabled", false, vscode.ConfigurationTarget.Global);
  }

  private provider(): vscode.InlineCompletionItemProvider {
    return {
      provideInlineCompletionItems: (document, position, _context, token) => (
        this.provide(document, position, token)
      ),
    };
  }

  private async provide(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const cfg = readHacklConfig();
    if (!cfg.autocomplete.enabled || !shouldProvideForDocument(document)) return undefined;

    const runtime = await this.resolveRuntime();
    this.updateStatus(runtime);
    if (!isSupportedRuntime(runtime)) return undefined;

    this.abortPendingRequest();
    const controller = new AbortController();
    this.inflight = controller;
    const cancelSubscription = token.onCancellationRequested(() => controller.abort());

    try {
      return await this.complete(document, position, cfg.autocomplete, runtime, controller);
    } finally {
      cancelSubscription.dispose();
      this.finishRequest(controller);
    }
  }

  private async complete(
    document: vscode.TextDocument,
    position: vscode.Position,
    cfg: AutocompleteConfig,
    runtime: SupportedRuntime,
    controller: AbortController,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const request = requestSnapshot(document, position);
    await wait(cfg.debounceMs, controller.signal, (timer) => {
      this.pendingTimer = timer;
    });
    if (controller.signal.aborted) return undefined;

    const completion = await fetchCompletion(document, request.position, cfg, runtime, controller.signal);
    if (!completion || isStaleRequest(document, request)) return undefined;

    return [new vscode.InlineCompletionItem(completion, new vscode.Range(request.position, request.position))];
  }

  private async resolveRuntime(): Promise<AutocompleteRuntime | undefined> {
    if (this.resolved) return this.resolved;
    if (this.resolving) return this.resolving;
    this.resolving = this.detectRuntime().finally(() => {
      this.resolving = undefined;
    });
    return this.resolving;
  }

  private async detectRuntime(): Promise<AutocompleteRuntime> {
    const cfg = readHacklConfig();
    if (!cfg.endpointConfigured && !cfg.autocomplete.endpointConfigured) {
      await ensureEngineReady();
    }
    const target = await resolveAutocompleteTarget({
      chatEndpoint: cfg.endpoint,
      chatEndpointConfigured: cfg.endpointConfigured,
      chatModel: cfg.model,
      autocomplete: cfg.autocomplete,
    });
    if (!target.available) {
      return this.cache({ kind: "unavailable", reason: target.reason });
    }
    const detection = await detectFim({ root: target.root, model: target.model });
    return this.cache({
      kind: "ready",
      endpoint: target.endpoint,
      root: target.root,
      model: target.model,
      detection,
    });
  }

  private cache(runtime: AutocompleteRuntime): AutocompleteRuntime {
    this.resolved = runtime;
    return runtime;
  }

  private async refresh(): Promise<void> {
    this.updateStatus();
    this.updateStatus(await this.resolveRuntime());
  }

  private updateStatus(runtime?: AutocompleteRuntime): void {
    const state = statusState(readHacklConfig().autocomplete.enabled, runtime);
    this.status.text = state.text;
    this.status.tooltip = state.tooltip;
    this.status.backgroundColor = state.warning
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
  }

  private invalidate(): void {
    this.resolved = undefined;
    this.resolving = undefined;
    this.abortPendingRequest();
  }

  private abortPendingRequest(): void {
    this.inflight?.abort();
    this.inflight = undefined;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
    }
  }

  private finishRequest(controller: AbortController): void {
    if (this.inflight === controller) {
      this.inflight = undefined;
    }
    this.pendingTimer = undefined;
  }
}

interface StatusState {
  text: string;
  tooltip: string;
  warning?: boolean;
}

interface CompletionRequest {
  uri: string;
  version: number;
  position: vscode.Position;
}

function statusState(enabled: boolean, runtime?: AutocompleteRuntime): StatusState {
  if (!enabled) {
    return { text: "$(sparkle) Hackl AC", tooltip: "Inline autocomplete is off. Click to enable." };
  }
  if (!runtime) {
    return { text: "$(loading~spin) Hackl AC", tooltip: "Resolving autocomplete endpoint and FIM support..." };
  }
  if (runtime.kind === "unavailable") {
    return { text: "$(circle-slash) Hackl AC", tooltip: `${runtime.reason} Click to retry.`, warning: true };
  }
  if (!runtime.detection.supported) {
    return { text: "$(circle-slash) Hackl AC", tooltip: `${runtime.detection.reason} Click to retry.`, warning: true };
  }
  return {
    text: `$(sparkle-filled) ${runtime.model ? shortModelLabel(runtime.model) : "Hackl AC"}`,
    tooltip: `Inline autocomplete is on - ${runtime.model ?? "loaded model"} - FIM ${runtime.detection.dialect}. Click to turn off.`,
  };
}

function isSupportedRuntime(runtime?: AutocompleteRuntime): runtime is SupportedRuntime {
  return Boolean(runtime && runtime.kind === "ready" && runtime.detection.supported);
}

function shouldProvideForDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === "file" || document.uri.scheme === "untitled";
}

function requestSnapshot(document: vscode.TextDocument, position: vscode.Position): CompletionRequest {
  return {
    uri: document.uri.toString(),
    version: document.version,
    position: new vscode.Position(position.line, position.character),
  };
}

async function fetchCompletion(
  document: vscode.TextDocument,
  position: vscode.Position,
  cfg: AutocompleteConfig,
  runtime: SupportedRuntime,
  signal: AbortSignal,
): Promise<string | undefined> {
  const { prefix, suffix } = sliceAroundCursor(document, position);
  if (!prefix.trim() && !suffix.trim()) return undefined;

  const completion = await requestFim(
    {
      root: runtime.root,
      model: runtime.model,
      support: runtime.detection,
      maxPredictMs: cfg.maxPredictMs,
    },
    {
      prefix,
      suffix,
      maxTokens: cfg.maxTokens,
      multiLine: cfg.multiLine,
      signal,
    },
  );
  if (!completion || !completion.trim() || signal.aborted) return undefined;
  return completion;
}

function sliceAroundCursor(document: vscode.TextDocument, position: vscode.Position): { prefix: string; suffix: string } {
  const prefixStartLine = Math.max(0, position.line - PREFIX_LINE_WINDOW);
  const suffixEndLine = Math.min(document.lineCount - 1, position.line + SUFFIX_LINE_WINDOW);
  const prefixStart = new vscode.Position(prefixStartLine, 0);
  const suffixEnd = document.lineAt(suffixEndLine).range.end;

  return {
    prefix: document.getText(new vscode.Range(prefixStart, position)),
    suffix: document.getText(new vscode.Range(position, suffixEnd)),
  };
}

function isStaleRequest(document: vscode.TextDocument, request: CompletionRequest): boolean {
  if (document.uri.toString() !== request.uri || document.version !== request.version) {
    return true;
  }
  const editor = vscode.window.activeTextEditor;
  return !editor
    || editor.document.uri.toString() !== request.uri
    || !editor.selection.isEmpty
    || !editor.selection.active.isEqual(request.position);
}

async function wait(
  ms: number,
  signal: AbortSignal,
  setTimerRef: (timer: ReturnType<typeof setTimeout>) => void,
): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    setTimerRef(timer);
    signal.addEventListener("abort", onAbort);
  });
}
