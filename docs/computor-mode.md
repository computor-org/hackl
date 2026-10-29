# Computor course mode

Computor uses Hackl for interactive tutoring. Hackl connects to an
OpenAI-compatible endpoint; the learner chooses a local model or supplies a
provider key with **Hackl: Set API Key**. Keys stay in VS Code SecretStorage,
separate from Computor login and API tokens. The endpoint receives the prompt,
selected code and assignment context. Check the provider's terms before sending
private material. There is no shared course inference key.

In GitHub Codespaces, configure an external HTTPS provider and your own key.
Disable the managed local engine. Models are not installed or run on the GitHub
VM. A Codespace consumes your GitHub quota; provider usage consumes your own
provider quota. Desktop VS Code can also connect to a local model server.

The Computor extension applies a window-local policy through Hackl's API:

```typescript
const hackl = await vscode.extensions.getExtension('computor-org.hackl')?.activate();
if (hackl?.coursePolicyVersion === 1) {
  hackl.applyCoursePolicy({
    scope: 'course/content',
    policy: { actionMode: 'ask', completion: 'off', independentCheck: false },
    teachingPrompt: 'Give hints and ask guiding questions; do not supply a finished solution.',
    assignmentContext: 'Published assignment material; never instructor references.'
  });
}
// On course exit/logout:
hackl?.clearCoursePolicy('course/content');
```

Existing basket API version 1 remains available. `coursePolicyVersion` identifies
the additive course API. Policies are copied and validated; invalid replacement
disables generation. They never change global learner settings. Changing or
clearing context aborts pending chat and inline completion requests.

Action ceilings are Ask, Edit, Work and Agent. Completion is controlled separately
as off, single-line or multi-line. Independent check disables chat, review and
completion. Yolo and all MCP tools are unavailable while a course policy applies.
External agent backends are unavailable in course mode because their own tools
cannot be constrained by Hackl's workspace tool runner. The chat reports its
active policy; inline completion shows a lock when disabled.

Ask-only enforces no writes or shell actions. It does not guarantee that a model
will never describe a solution. Learners control their own editor installation,
so this is a teaching policy, not a secure examination environment. Examination
rules must also be enforced by the assessment environment.
