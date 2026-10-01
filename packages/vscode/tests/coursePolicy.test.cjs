const test = require("node:test");
const assert = require("node:assert/strict");
const { CoursePolicyController, coursePolicyController, runCoursePolicyRequest } = require("../dist/coursePolicy.js");
const policy = { actionMode: "ask", completion: "off", independentCheck: false };

test("applying and clearing course context cancels outstanding work without changing settings", () => {
  const controller = new CoursePolicyController();
  const first = controller.signal;
  controller.apply({ scope: "course-a", policy, teachingPrompt: "Guide" });
  assert.equal(first.aborted, true);
  assert.deepEqual(controller.current.policy, policy);
  const second = controller.signal;
  controller.apply({ scope: "course-b", policy: { ...policy, independentCheck: true } });
  assert.equal(second.aborted, true);
  controller.clear("course-a");
  assert.equal(controller.current.scope, "course-b");
  const third = controller.signal;
  controller.clear("course-b");
  assert.equal(third.aborted, true);
  assert.equal(controller.current, undefined);
});

test("invalid replacement immediately cancels generation and leaves AI disabled", () => {
  const controller = new CoursePolicyController();
  controller.apply({ scope: "valid", policy });
  const signal = controller.signal;
  assert.throws(() => controller.apply({ scope: "valid", policy: { ...policy, actionMode: "yolo" } }), /Invalid/);
  assert.equal(signal.aborted, true);
  assert.equal(controller.current.policy.independentCheck, true);
  assert.throws(() => controller.apply({ scope: "" }), /Invalid/);
  assert.equal(controller.current.policy.independentCheck, true);
});

test("context is copied; stale leases and disposed listeners cannot alter new policy", () => {
  const controller = new CoursePolicyController();
  let changes = 0;
  const listener = controller.onChange(() => changes++);
  const source = { scope: "one", policy: { ...policy } };
  controller.apply(source);
  source.policy.actionMode = "agent";
  assert.equal(controller.current.policy.actionMode, "ask");
  listener.dispose();
  const previous = changes;
  controller.clear();
  assert.equal(changes, previous);
});

test("independent check blocks review before dispatch; replacing policy aborts an active request", async () => {
  coursePolicyController.apply({ scope: "check", policy: { ...policy, independentCheck: true } });
  let calls = 0;
  const denied = await runCoursePolicyRequest({ mode: "ask", options: { createAnnotations: true } }, async () => { calls++; });
  assert.match(denied.content, /disabled/);
  assert.equal(calls, 0);
  coursePolicyController.apply({ scope: "course", policy });
  await runCoursePolicyRequest({ mode: "ask" }, async args => {
    assert.equal(args.signal.aborted, false);
    coursePolicyController.clear();
    assert.equal(args.signal.aborted, true);
    return { content: "cancelled by provider" };
  });
});

test("invalid teaching context disables generation without exposing the previous context", () => {
  const controller = new CoursePolicyController();
  for (const invalid of [{ teachingPrompt: 7 }, { assignmentContext: 'x'.repeat(100001) }, { scope: 'x'.repeat(1025) }]) {
    controller.apply({ scope: 'prior', policy, assignmentContext: 'prior task' });
    assert.throws(() => controller.apply({ scope: 'next', policy, ...invalid }), /Invalid/);
    assert.equal(controller.current.policy.independentCheck, true);
    assert.equal(controller.current.assignmentContext, undefined);
  }
});

test("caller cancellation reaches dispatch and blocked modes never call the provider", async () => {
  coursePolicyController.apply({ scope: 'course', policy });
  const controller = new AbortController();
  controller.abort();
  await runCoursePolicyRequest({ signal: controller.signal }, async args => {
    assert.equal(args.signal.aborted, true);
    return { content: 'cancelled' };
  });
  let calls = 0;
  await runCoursePolicyRequest({ mode: 'yolo' }, async () => { ++calls; });
  assert.equal(calls, 0);
  coursePolicyController.clear();
});

test("course transitions clear chat and attachments, show restrictions, and workspace exit restores ordinary mode", () => {
  const { registerCoursePolicy } = require('../dist/coursePolicy.js');
  const { __setVscodeForTests } = require('../dist/vscodeShim.js');
  let workspaceChange;
  const commands = [], statuses = [];
  let resets = 0, cleared = 0, states = 0;
  __setVscodeForTests({
    commands: { executeCommand: (...args) => { commands.push(args); return Promise.resolve(); } },
    workspace: { onDidChangeWorkspaceFolders: handler => { workspaceChange = handler; return { dispose() {} }; } },
  });
  const context = { subscriptions: [] };
  try {
    registerCoursePolicy(context, { notifyStatus: text => statuses.push(text),
      postState: async () => { ++states; }, resetCourseContext: async () => { ++resets; } }, () => { ++cleared; });
    coursePolicyController.apply({ scope: 'course', policy });
    assert.match(statuses.at(-1), /Course mode: ask/);
    coursePolicyController.apply({ scope: 'exam', policy: { ...policy, independentCheck: true } });
    assert.match(statuses.at(-1), /AI assistance disabled/);
    const pending = coursePolicyController.signal;
    workspaceChange();
    assert.equal(pending.aborted, true);
    assert.equal(coursePolicyController.current, undefined);
    assert.equal(cleared, resets);
    assert.equal(states, resets);
    assert.deepEqual(commands.at(-1), ['setContext', 'hackl.independentCheck', false]);
    assert.equal(statuses.at(-1), 'Course policy cleared');
  } finally {
    for (const subscription of context.subscriptions) subscription.dispose();
    __setVscodeForTests(undefined);
  }
});
