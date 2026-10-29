import { BackendChoice, CourseContext, CodexDetection, HacklConfig, detectCodex, pickAvailableModel, resolveChatTarget, validateModelEndpoint } from "@hackl/core";
import { ensureEngineReady } from "./enginePanel";
import type { ChatAnswer } from "./chatSession";

export async function resolveCourseModel(cfg: HacklConfig, stored: BackendChoice | undefined,
  fallbackModel: string | undefined, course: Readonly<CourseContext> | undefined, hasKey: boolean):
  Promise<ChatAnswer | { useCodex: boolean; codexCommand: string; codexDetection?: CodexDetection; target: { endpoint: string; model: string } }> {
  const useCodex = stored?.kind === "codex" && cfg.codexEnabled;
  if (course && useCodex) {
    return { content: "Course mode requires an OpenAI-compatible model endpoint. The external agent backend cannot enforce the course tool policy." };
  }
  let codexCommand = cfg.codexCommand;
  let codexDetection: CodexDetection | undefined;
  let target: { endpoint: string; model: string };
  if (useCodex) {
    codexDetection = await detectCodex({ command: cfg.codexCommand });
    if (!codexDetection.available) {
      return { content: `Codex is not available: ${codexDetection.error ?? "command not found"}` };
    }
    if (codexDetection.authMode === "none") {
      return { content: "Codex is installed but not logged in. Run `codex login`, then try again." };
    }
    codexCommand = codexDetection.command;
    const model = pickAvailableModel(codexDetection.models, stored?.model ?? fallbackModel);
    if (!model) {
      return { content: "Codex is installed but no Codex models are available." };
    }
    target = { endpoint: "codex", model };
  } else {
    if (process.env.CODESPACES === "true") {
      if (!cfg.endpointConfigured) return { content: "Codespaces requires an external HTTPS model endpoint and your own provider key. Configure Hackl before chatting." };
      validateModelEndpoint(cfg.endpoint, hasKey, true);
    }
    await ensureEngineReady();
    const preferredModel = cfg.model || (stored?.kind === "local" ? stored.model : "");
    target = await resolveChatTarget({
      endpoint: cfg.endpoint,
      endpointConfigured: cfg.endpointConfigured,
      preferredModel,
    });
  }
  return { useCodex, codexCommand, codexDetection, target };
}
