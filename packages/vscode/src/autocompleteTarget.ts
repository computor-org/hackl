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
    const target = await resolveChatTargetImpl({
      endpoint: input.autocomplete.endpoint,
      endpointConfigured: true,
      preferredModel: input.autocomplete.model,
    });
    return gateFimCapability({
      available: true,
      endpoint: target.endpoint,
      root: toRootBase(target.endpoint),
      model: resolvedModel(input.autocomplete.model, target.model),
      source: "configured",
      remote: requiresNonLocalEndpointApproval(target.endpoint),
    });
  }

  // No dedicated autocomplete endpoint: always reuse the chat endpoint, local or
  // not. A configured autocomplete.model belongs to the removed endpoint, so it
  // is ignored here; FIM runs on whatever model the chat endpoint has loaded.
  const target = await resolveChatTargetImpl({
    endpoint: input.chatEndpoint,
    endpointConfigured: input.chatEndpointConfigured,
    preferredModel: input.chatModel,
  });
  return gateFimCapability({
    available: true,
    endpoint: target.endpoint,
    root: toRootBase(target.endpoint),
    model: resolvedModel("", target.model),
    source: "chat-fallback",
    remote: requiresNonLocalEndpointApproval(target.endpoint),
  });
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
