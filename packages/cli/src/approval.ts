import type { ApprovalRequest } from "@hackl/core";

export interface ApproverOptions {
  autoApprove: boolean;
  // Interactive question hook (readline). Absent in non-interactive runs.
  ask?: (question: string) => Promise<string>;
}

// Build the approval callback the Session/tool runner calls before a gated
// action (commands, non-git workspaces, MCP tools). Non-interactive runs
// default-deny unless --yes was passed.
export function createApprover(options: ApproverOptions): (request: ApprovalRequest) => Promise<boolean> {
  return async (request) => {
    if (options.autoApprove) {
      return true;
    }
    if (!options.ask) {
      return false;
    }
    const prompt = `\n${request.title}\n${request.detail}\n${request.approveLabel}/${request.denyLabel}? [y/N] `;
    const answer = (await options.ask(prompt)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  };
}
