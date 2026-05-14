import * as vscode from "vscode";
import { BasketService, HacklTarget, createCurrentFileTarget } from "./basket";
import { buildStagedChangesTarget } from "./gitTargets";

export type ReviewTargetsResult = HacklTarget[] | { error: string };
type StagedTargetBuilder = () => Promise<HacklTarget | { error: string }>;

export async function resolveReviewTargets(
  basketService: BasketService,
  stagedTargetBuilder: StagedTargetBuilder = buildStagedChangesTarget,
): Promise<ReviewTargetsResult> {
  const targets: HacklTarget[] = [];
  const staged = await stagedTargetBuilder();
  if (!("error" in staged)) targets.push(staged);

  targets.push(...basketService.list());
  if (targets.length > 0) return targets;

  const editor = vscode.window.activeTextEditor;
  if (!editor) return { error: "Stage changes, attach context, or open a file first." };

  const target = createCurrentFileTarget(editor);
  return target ? [target] : { error: "Stage changes, attach context, or open a file first." };
}
