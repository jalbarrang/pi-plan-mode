/** Approval gate for a model-authored declarative workflow. */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import { validateWorkflowSpec, workflowSummary, type WorkflowSpec } from '../workflow/spec.js';

export interface SubmitWorkflowCallbacks {
  onDraft: (workflow: WorkflowSpec) => void;
}

export interface WorkflowLauncher {
  launch(workflow: WorkflowSpec): Promise<string>;
}

export function registerSubmitWorkflowTool(
  pi: ExtensionAPI,
  controller: WorkflowLauncher,
  callbacks: SubmitWorkflowCallbacks,
): void {
  pi.registerTool({
    name: 'submit_workflow',
    label: 'Submit Workflow',
    description: 'Validate, show, edit, and explicitly approve a bounded background workflow before launch.',
    promptSnippet: 'Submit a workflow for user review and explicit approval',
    promptGuidelines: [
      'Use only after the user agrees with the workflow shape.',
      'The user reviews the exact JSON and can edit or cancel it before it launches.',
      'Every dynamic fan-out needs an earlier named output and maxItems.',
    ],
    parameters: Type.Object({
      workflow: Type.Any({ description: 'Declarative workflow object with name, description, task, and chain phases.' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx?.hasUI) {
        return {
          content: [{ type: 'text' as const, text: 'Workflow launch rejected: interactive approval is unavailable.' }],
          details: { rejected: true, reason: 'missing-ui' },
          isError: true,
        };
      }

      let source: unknown = params.workflow;
      while (true) {
        const validation = validateWorkflowSpec(source);
        if (!validation.valid || !validation.normalized || validation.maximumAgentCount === undefined) {
          return {
            content: [{ type: 'text' as const, text: `Workflow rejected:\n- ${validation.errors.join('\n- ')}` }],
            details: { rejected: true, errors: validation.errors },
            isError: true,
          };
        }
        const workflow = validation.normalized;
        callbacks.onDraft(workflow);
        const preview = `${workflowSummary(workflow, validation.maximumAgentCount)}\n\nExact workflow JSON:\n${JSON.stringify(workflow, null, 2)}`;
        const choice = await ctx.ui.select(`${preview}\n\nApprove background workflow?`, [
          'Run workflow',
          'Edit JSON',
          'Cancel',
        ]);
        if (choice === 'Cancel' || !choice) {
          return {
            content: [{ type: 'text' as const, text: 'Workflow launch cancelled. The draft remains available for /workflow save.' }],
            details: { cancelled: true, workflow },
          };
        }
        if (choice === 'Edit JSON') {
          const edited = await ctx.ui.editor(preview, JSON.stringify(workflow, null, 2));
          if (!edited?.trim()) {
            return {
              content: [{ type: 'text' as const, text: 'Workflow launch cancelled. No edited JSON was provided.' }],
              details: { cancelled: true, workflow },
            };
          }
          try {
            source = JSON.parse(edited);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: 'text' as const, text: `Workflow rejected: edited JSON is invalid (${message}).` }],
              details: { rejected: true, reason: 'invalid-json' },
              isError: true,
            };
          }
          continue;
        }
        try {
          const runId = await controller.launch(workflow);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Workflow "${workflow.name}" launched in the background as ${runId}. Use /workflow status, /workflow stop, or /workflow resume to control it.`,
              },
            ],
            details: { workflow, runId, maximumAgentCount: validation.maximumAgentCount },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text' as const, text: `Workflow launch failed: ${message}` }],
            details: { rejected: true, reason: 'engine-unavailable' },
            isError: true,
          };
        }
      }
    },
    renderCall(args, theme) {
      const name = ((args as { workflow?: { name?: string } }).workflow?.name ?? 'workflow') as string;
      return new Text(theme.fg('toolTitle', theme.bold('submit_workflow ')) + theme.fg('accent', name), 0, 0);
    },
    renderResult(result, _options, theme) {
      const details = result.details as { runId?: string; cancelled?: boolean } | undefined;
      const label = details?.runId
        ? `✓ Background workflow started: ${details.runId}`
        : details?.cancelled
          ? 'Workflow launch cancelled'
          : 'Workflow not launched';
      return new Text(theme.fg(details?.runId ? 'success' : 'muted', label), 0, 0);
    },
  });
}
