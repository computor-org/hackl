import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { HacklTarget, ReviewContext } from "./basket";
import type { HacklReviewComment } from "./reviewComments";
import type { PromptMode } from "./prompt";

export interface ReviewSession {
  id: string;
  createdAt: string;
  mode: PromptMode;
  endpoint?: string;
  model?: string;
  gitHead?: string;
  targets: HacklTarget[];
  context?: ReviewContext;
  questions?: string[];
  answer?: string;
  comments: HacklReviewComment[];
}

let counter = 0;

export function newReviewSessionId(): string {
  counter += 1;
  return `rs-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export async function persistReviewSession(
  workspaceRoot: string,
  session: ReviewSession,
): Promise<string | undefined> {
  if (!workspaceRoot) return undefined;
  const dir = path.join(workspaceRoot, ".hackl", "reviews");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${session.id}.json`);
  await fs.writeFile(file, JSON.stringify(session, null, 2), "utf8");
  return file;
}
