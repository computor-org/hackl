import * as vscode from "vscode";
import { detectFim, FimDetectionResult, toRootBase } from "./fimDetect";
import { requestFim } from "./fimClient";
import { resolveChatTarget } from "./localServers";

interface AutocompleteSettings {
  enabled: boolean;
  endpoint?: string;
  endpointConfigured: boolean;
  model?: string;
  maxTokens: number;
  debounceMs: number;
  multiLine: boolean;
  maxPredictMs: number;
}

interface ResolvedAutocomplete {
  root: string;
  model?: string;
  detection: FimDetectionResult;
}

const STATUS_PRIORITY = 50;
const COMMAND_TOGGLE = "hackl.toggleAutocomplete";

export function registerAutocomplete(context: vscode.ExtensionContext): void {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, STATUS_PRIORITY);
  status.command = COMMAND_TOGGLE;
  status.show();
  context.subscriptions.push(status);

  let resolved: ResolvedAutocomplete | undefined;
  let resolving: Promise<ResolvedAutocomplete | undefined> | undefined;
  let pendingTimer: NodeJS.Timeout | undefined;
  let inflight: AbortController | undefined;

  const readSettings = (): AutocompleteSettings => {
    const cfg = vscode.workspace.getConfiguration("hackl");
    const endpointRaw = cfg.get<string>("autocomplete.endpoint", "");
    const inspect = cfg.inspect<string>("autocomplete.endpoint");
    return {
      enabled: cfg.get<boolean>("autocomplete.enabled", false),
      endpoint: endpointRaw.trim() || undefined,
      endpointConfigured: hasUserConfigured(inspect),
      model: (cfg.get<string>("autocomplete.model", "") || "").trim() || undefined,
      maxTokens: cfg.get<number>("autocomplete.maxTokens", 48),
      debounceMs: cfg.get<number>("autocomplete.debounceMs", 150),
      multiLine: cfg.get<boolean>("autocomplete.multiLine", false),
      maxPredictMs: cfg.get<number>("autocomplete.maxPredictMs", 400),
    };
  };

  const resolve = async (): Promise<ResolvedAutocomplete | undefined> => {
    if (resolved) return resolved;
    if (resolving) return resolving;
    resolving = (async () => {
      const settings = readSettings();
      let endpointBase: string;
      let model: string | undefined = settings.model;
      if (settings.endpoint) {
        endpointBase = settings.endpoint;
      } else {
        const chatCfg = vscode.workspace.getConfiguration("hackl");
        const chatTarget = await resolveChatTarget({
          endpoint: chatCfg.get<string>("endpoint", ""),
          endpointConfigured: hasUserConfigured(chatCfg.inspect<string>("endpoint")),
        });
        endpointBase = chatTarget.endpoint;
        model = model ?? chatTarget.model;
      }
      const root = toRootBase(endpointBase);
      const detection = await detectFim({ root });
      const next: ResolvedAutocomplete = { root, model, detection };
      resolved = next;
      return next;
    })().finally(() => {
      resolving = undefined;
    });
    return resolving;
  };

  const updateStatus = (settings: AutocompleteSettings, res: ResolvedAutocomplete | undefined): void => {
    if (res && !res.detection.supported) {
      status.text = "$(circle-slash) Hackl AC";
      status.tooltip = `Autocomplete unavailable: ${res.detection.reason}`;
      status.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      return;
    }
    status.backgroundColor = undefined;
    if (settings.enabled) {
      const dialect = res?.detection.supported ? res.detection.dialect : "?";
      status.text = "$(sparkle-filled) Hackl AC";
      status.tooltip = `Inline autocomplete: on (FIM: ${dialect}). Click to disable.`;
    } else {
      status.text = "$(sparkle) Hackl AC";
      status.tooltip = "Inline autocomplete: off. Click to enable.";
    }
  };

  const refresh = async (): Promise<void> => {
    const settings = readSettings();
    updateStatus(settings, resolved);
    const res = await resolve();
    updateStatus(settings, res);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_TOGGLE, async () => {
      const cfg = vscode.workspace.getConfiguration("hackl");
      const current = cfg.get<boolean>("autocomplete.enabled", false);
      await cfg.update("autocomplete.enabled", !current, vscode.ConfigurationTarget.Global);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("hackl.autocomplete") || event.affectsConfiguration("hackl.endpoint")) {
        resolved = undefined;
        void refresh();
      }
    }),
  );

  const provider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(document, position, _ctx, token) {
      const settings = readSettings();
      if (!settings.enabled) return undefined;
      if (document.uri.scheme === "output") return undefined;

      const res = await resolve();
      if (!res || !res.detection.supported) return undefined;

      if (pendingTimer) clearTimeout(pendingTimer);
      inflight?.abort();
      const controller = new AbortController();
      inflight = controller;
      const cancelOnToken = () => controller.abort();
      token.onCancellationRequested(cancelOnToken);

      await new Promise<void>((resolveDelay) => {
        pendingTimer = setTimeout(resolveDelay, settings.debounceMs);
      });
      if (controller.signal.aborted) return undefined;

      const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
      const lastLine = document.lineCount - 1;
      const endPos = document.lineAt(lastLine).range.end;
      const suffix = document.getText(new vscode.Range(position, endPos));

      if (!prefix.trim() && !suffix.trim()) return undefined;

      const completion = await requestFim(
        {
          root: res.root,
          model: res.model,
          support: res.detection,
          maxPredictMs: settings.maxPredictMs,
        },
        {
          prefix,
          suffix,
          maxTokens: settings.maxTokens,
          multiLine: settings.multiLine,
          signal: controller.signal,
        },
      );
      if (!completion || !completion.trim()) return undefined;

      return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))];
    },
  };

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider),
  );

  void refresh();
}

interface ConfigInspection<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
  globalLanguageValue?: T;
  workspaceLanguageValue?: T;
  workspaceFolderLanguageValue?: T;
}

function hasUserConfigured<T>(inspection: ConfigInspection<T> | undefined): boolean {
  if (!inspection) return false;
  const values = [
    inspection.globalValue,
    inspection.workspaceValue,
    inspection.workspaceFolderValue,
    inspection.globalLanguageValue,
    inspection.workspaceLanguageValue,
    inspection.workspaceFolderLanguageValue,
  ];
  return values.some((v) => v !== undefined && (typeof v !== "string" || v.trim() !== ""));
}
