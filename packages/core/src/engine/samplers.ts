import type { ModelOption } from "./catalog";
import type { Knobs } from "./config";

// Blessed sampler presets, a small subset of slopcode-infra's per-model matrix.
// Qwen's "thinking + precise coding" preset is the default for agent loops; the
// matrix can grow as more families are added.
export function samplerArgs(model: ModelOption | undefined, knobs: Knobs): string[] {
  const family = model?.family;

  if (family === "gpt-oss") {
    return ["--temp", "1.0", "--top-p", "1.0", "--top-k", "40", "--min-p", "0",
      "--presence-penalty", "0.0", "--repeat-penalty", "1.0",
      "--reasoning-format", "none", "--no-context-shift"];
  }
  if (family === "gemma") {
    return ["--temp", "1.0", "--top-p", "0.95", "--top-k", "40", "--min-p", "0",
      "--presence-penalty", "0.0", "--repeat-penalty", "1.0", "--no-context-shift"];
  }

  // qwen / qwen-coder default.
  const args = ["--temp", "0.6", "--top-p", "0.95", "--top-k", "20", "--min-p", "0",
    "--presence-penalty", "0.0", "--repeat-penalty", "1.0",
    "--reasoning-format", "deepseek", "--reasoning-budget", String(knobs.reasoningBudget),
    "--no-context-shift"];
  if (knobs.mtp) {
    args.push("--spec-type", "draft-mtp", "--spec-draft-n-max", String(knobs.specDraftNMax),
      "--cache-type-k-draft", knobs.cacheTypeK, "--cache-type-v-draft", knobs.cacheTypeV);
  }
  return args;
}
