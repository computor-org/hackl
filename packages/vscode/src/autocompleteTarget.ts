import { AutocompleteConfig } from "./config";
import { DEFAULT_CHAT_MODEL, requiresNonLocalEndpointApproval, resolveChatTarget } from "@hackl/core";
import { fimCapableByModelName, toRootBase } from "./fimDetect";

export interface ResolveAutocompleteTargetInput {
  chatEndpoint: string;
  chatEndpointConfigured: boolean;
  chatModel?: string;
  autocomplete: Pick<AutocompleteConfig, "endpoint" | "endpointConfigured" | "model">;
}

export type AutocompleteTargetResolution =
  | {
      available: true;
      endpoint: string;
      root: string;
      model?: string;
      source: "configured" | "chat-fallback";
      remote: boolean;
    }
  | {
      available: false;
      reason: string;
    };

interface ResolveAutocompleteTargetDeps {
  resolveChatTargetImpl?: typeof resolveChatTarget;
}

export async function resolveAutocompleteTarget(
  input: ResolveAutocompleteTargetInput,
  deps: ResolveAutocompleteTargetDeps = {},
): Promise<AutocompleteTargetResolution> {
  const resolveChatTargetImpl = deps.resolveChatTargetImpl ?? resolveChatTarget;

  if (input.autocomplete.endpointConfigured && input.autocomplete.endpoint) {
    const resolved = await resolve(
      resolveChatTargetImpl,
      input.autocomplete.endpoint,
      true,
      input.autocomplete.model,
    );
    if (!resolved.ok) return { available: false, reason: resolved.reason };
    return gateFimCapability({
      available: true,
      endpoint: resolved.endpoint,
      root: toRootBase(resolved.endpoint),
      model: resolvedModel(input.autocomplete.model, resolved.model),
      source: "configured",
      remote: requiresNonLocalEndpointApproval(resolved.endpoint),
    });
  }

  // No dedicated autocomplete endpoint: always reuse the chat endpoint, local or
  // not. A configured autocomplete.model belongs to the removed endpoint, so it
  // is ignored here; FIM runs on whatever model the chat endpoint has loaded.
  const resolved = await resolve(
    resolveChatTargetImpl,
    input.chatEndpoint,
    input.chatEndpointConfigured,
    input.chatModel,
  );
  if (!resolved.ok) return { available: false, reason: resolved.reason };
  return gateFimCapability({
    available: true,
    endpoint: resolved.endpoint,
    root: toRootBase(resolved.endpoint),
    model: resolvedModel("", resolved.model),
    source: "chat-fallback",
    remote: requiresNonLocalEndpointApproval(resolved.endpoint),
  });
}

// A configured endpoint that advertises no model makes resolveChatTarget raise.
// Autocomplete sends no credentials at all, so it stays off instead of failing
// every completion request.
async function resolve(
  impl: typeof resolveChatTarget,
  endpoint: string,
  endpointConfigured: boolean,
  preferredModel: string | undefined,
): Promise<{ ok: true; endpoint: string; model: string } | { ok: false; reason: string }> {
  try {
    const target = await impl({ endpoint, endpointConfigured, preferredModel });
    return { ok: true, endpoint: target.endpoint, model: target.model };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function resolvedModel(configuredModel: string, detectedModel: string | undefined): string | undefined {
  if (configuredModel) return configuredModel;
  if (!detectedModel || detectedModel === DEFAULT_CHAT_MODEL) return undefined;
  return detectedModel;
}

// Reject a resolved target whose model is a known chat-only family (e.g. Gemma)
// so autocomplete never fires against a model that lacks infill tokens. Unknown
// model ids pass through; the /tokenize probe is the final arbiter for them.
function gateFimCapability(
  resolution: Extract<AutocompleteTargetResolution, { available: true }>,
): AutocompleteTargetResolution {
  if (fimCapableByModelName(resolution.model) === false) {
    return {
      available: false,
      reason: `Autocomplete model "${resolution.model}" is a chat-only family without FIM tokens. Set hackl.autocomplete.endpoint to a coder model.`,
    };
  }
  return resolution;
}
