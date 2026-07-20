/** Approval gate for a model-authored declarative workflow. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import { WORKFLOW_DRAFTS_ROOT } from '../ledger.js';
import { resolveWorkflowDraftFile } from '../utils.js';
import { validateWorkflowSpec, workflowTable, type WorkflowSpec } from '../workflow/spec.js';

export interface SubmitWorkflowCallbacks {
  onDraft: (workflow: WorkflowSpec) => void;
}

export interface WorkflowLauncher {
  launch(workflow: WorkflowSpec): Promise<string>;
}

export interface SubmitWorkflowOptions {
  draftsRoot?: string;
}

async function saveDraft(path: string, workflow: WorkflowSpec): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(workflow, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

export function registerSubmitWorkflowTool(
  pi: ExtensionAPI,
  controller: WorkflowLauncher,
  callbacks: SubmitWorkflowCallbacks,
  options: SubmitWorkflowOptions = {},
): void {
  const draftsRoot = options.draftsRoot ?? WORKFLOW_DRAFTS_ROOT;
  pi.registerTool({
    name: 'submit_workflow',
    label: 'Submit Workflow',
    description: 'Load a workflow draft file, validate and preview it, then explicitly approve its background launch.',
    promptSnippet: 'Write the workflow JSON to the drafts folder first, then submit it by name for user review and approval',
    promptGuidelines: [
      'Use only after the user agrees with the workflow shape.',
      'Write the workflow JSON to the drafts folder first, then submit it by name.',
      'The user reviews a phase table and can edit the exact JSON or cancel before launch.',
      'Every dynamic fan-out needs an earlier named output and maxItems.',
    ],
    parameters: Type.Object({
      file: Type.String({ description: 'Draft name (kebab) or path under the workflow drafts folder, e.g. "my-run" for .taskman/workflows/my-run.json.' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx?.hasUI) {
        return {
          content: [{ type: 'text' as const, text: 'Workflow launch rejected: interactive approval is unavailable.' }],
          details: { rejected: true, reason: 'missing-ui' },
          isError: true,
        };
      }

      let path: string;
      try {
        path = resolveWorkflowDraftFile(params.file, draftsRoot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Workflow rejected: ${message}` }],
          details: { rejected: true, reason: 'invalid-draft-path' },
          isError: true,
        };
      }

      let source: unknown;
      try {
        source = JSON.parse(await readFile(path, 'utf8'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Workflow rejected: unable to read workflow draft at ${path} (${message}). Write the workflow JSON there with the write tool, then resubmit.` }],
          details: { rejected: true, reason: 'invalid-draft-file', path },
          isError: true,
        };
      }

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
        const preview = [
          `Workflow: ${workflow.name}`,
          workflow.description,
          `Maximum agents: ${validation.maximumAgentCount}`,
          '',
          workflowTable(workflow),
          '',
          `Full JSON: ${path} — choose "Edit JSON" to view or modify the exact spec.`,
        ].join('\n');
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
            await saveDraft(path, source as WorkflowSpec);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: 'text' as const, text: `Workflow rejected: edited JSON is invalid or could not be saved at ${path} (${message}).` }],
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
      const file = ((args as { file?: string }).file ?? 'workflow') as string;
      return new Text(theme.fg('toolTitle', theme.bold('submit_workflow ')) + theme.fg('accent', file), 0, 0);
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
