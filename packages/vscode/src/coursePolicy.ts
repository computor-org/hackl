import { CourseContext, DISABLED_COURSE_POLICY, validateCoursePolicy, courseAllowsMode } from "@hackl/core";
import type * as vscodeTypes from "vscode";
import { getVscode } from "./vscodeShim";
import type { PromptHandlerArgs, ChatAnswer } from "./chatSession";

// Window-local host state, never persisted to learner settings. Consumers abort
// pending requests whenever the host context changes, including policy clearing.
export class CoursePolicyController {
  private context?: Readonly<CourseContext>;
  private controller = new AbortController();
  private readonly listeners = new Set<() => void>();

  get current(): Readonly<CourseContext> | undefined { return this.context; }
  get signal(): AbortSignal { return this.controller.signal; }

  apply(input: CourseContext): void {
    this.change({ scope: typeof input?.scope === "string" ? input.scope : "invalid",
      policy: DISABLED_COURSE_POLICY });
    if (!input || typeof input.scope !== "string" || !input.scope.trim() || input.scope.length > 1024) {
      throw new Error("Invalid course scope");
    }
    for (const value of [input.teachingPrompt, input.assignmentContext]) {
      if (value !== undefined && (typeof value !== "string" || value.length > 100000)) {
        throw new Error("Invalid course teaching context");
      }
    }
    this.change(Object.freeze({ scope: input.scope, policy: validateCoursePolicy(input.policy),
      teachingPrompt: input.teachingPrompt, assignmentContext: input.assignmentContext }));
  }

  clear(scope?: string): void {
    if (scope !== undefined && scope !== this.context?.scope) return;
    this.change(undefined);
  }

  onChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  private change(context: Readonly<CourseContext> | undefined): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.context = context;
    for (const listener of this.listeners) listener();
  }
}

export const coursePolicyController = new CoursePolicyController();

export async function runCoursePolicyRequest(args: PromptHandlerArgs,
  run: (args: PromptHandlerArgs, course?: Readonly<CourseContext>) => Promise<ChatAnswer>): Promise<ChatAnswer> {
  const course = coursePolicyController.current;
  if (!courseAllowsMode(course?.policy, args.mode ?? "ask")) {
    return { content: "This action is disabled by the course assistant policy." };
  }
  const controller = new AbortController();
  const signals = [coursePolicyController.signal, args.signal].filter((s): s is AbortSignal => Boolean(s));
  const abort = () => controller.abort();
  for (const signal of signals) {
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
  }
  try {
    return await run({ ...args, signal: controller.signal }, course);
  } finally {
    for (const signal of signals) signal.removeEventListener("abort", abort);
  }
}

export function registerCoursePolicy(context: vscodeTypes.ExtensionContext,
  chat: { notifyStatus(text: string): void; postState(): Promise<void>; resetCourseContext(): Promise<void> },
  clearBasket: () => void): void {
  const vscode = getVscode();
  context.subscriptions.push(
    coursePolicyController.onChange(() => {
      clearBasket();
      void chat.resetCourseContext();
      const course = coursePolicyController.current;
      void vscode.commands.executeCommand("setContext", "hackl.coursePolicy", Boolean(course));
      void vscode.commands.executeCommand("setContext", "hackl.independentCheck", Boolean(course?.policy.independentCheck));
      chat.notifyStatus(!course ? "Course policy cleared" : course.policy.independentCheck
        ? "Independent check: AI assistance disabled" : `Course mode: ${course.policy.actionMode}, completion ${course.policy.completion}`);
      void chat.postState();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => coursePolicyController.clear()),
    { dispose: () => coursePolicyController.clear() },
  );
}
