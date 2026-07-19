import { WORKFLOW_TOOLS } from '../constants.js';

export function buildWorkflowModePrompt(): string {
  return `[WORKFLOW MODE ACTIVE]
You are designing a bounded, reusable background workflow. You may inspect the repository, consult read-only subagents, and ask the user focused questions. Do not change product files, run implementation agents, or launch a workflow directly.

Available tools: ${WORKFLOW_TOOLS.join(', ')}

Rules:
- Bash is read-only. Writes and edits are unavailable in this mode.
- Use subagent only for discovery or status; submit_workflow is the sole approval-and-launch seam.
- A workflow is declarative JSON: an agent step, a parallel group, or a bounded fan-out phase. Never use loops, conditionals, arbitrary code, or unbounded fan-out.
- Every fan-out must reference an earlier named output, point at an array with a JSON pointer, and declare maxItems.
- Prefer one mutation-capable worker at a time. Parallel agents should be independent readers, reviewers, or isolated worktree tasks.
- Include the original task, a kebab-case name, a short description, and a concrete chain. Name outputs with "as" when later phases consume them.
- Before submit_workflow, explain the phase list and maximum agent count. submit_workflow will show the exact JSON for user approval and launch only that approved version.

Use submit_workflow only after the user agrees with the workflow shape.`;
}
