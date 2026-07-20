/** Read-only workflow run status from the live engine or persisted run snapshots. */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import { WORKFLOW_RUNS_ROOT } from '../ledger.js';
import { SubagentWorkflowRpc, type WorkflowRunSnapshot } from '../workflow/subagents-rpc.js';

const STALE_AFTER_MS = 30_000;

type WorkflowRpcStatus = Pick<SubagentWorkflowRpc, 'status'>;
type PersistedWorkflowRunSnapshot = WorkflowRunSnapshot & { updatedAt?: string; workflow?: { name?: string; description?: string } };

export interface WorkflowStatusOptions {
  runsRoot?: string;
  rpc?: WorkflowRpcStatus;
  now?: () => number;
}

interface ResolvedRun {
  snapshot: PersistedWorkflowRunSnapshot;
  source: 'rpc' | 'file';
  updatedAt: string;
  stale: boolean;
}

function isSnapshot(value: unknown): value is PersistedWorkflowRunSnapshot {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' && Array.isArray((value as { phases?: unknown }).phases);
}

function updatedAt(snapshot: PersistedWorkflowRunSnapshot, now: number): string {
  return snapshot.updatedAt ?? snapshot.finishedAt ?? snapshot.startedAt ?? new Date(now).toISOString();
}

function isStale(snapshot: PersistedWorkflowRunSnapshot, timestamp: string, now: number): boolean {
  const age = Date.parse(timestamp);
  return snapshot.status === 'running' && !Number.isNaN(age) && now - age > STALE_AFTER_MS;
}

function formatAge(timestamp: string, now: number): string {
  const milliseconds = Math.max(0, now - Date.parse(timestamp));
  if (Number.isNaN(milliseconds) || milliseconds < 1_000) return 'just now';
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

async function loadRunFiles(runsRoot: string): Promise<PersistedWorkflowRunSnapshot[]> {
  let files: string[];
  try {
    files = await readdir(runsRoot);
  } catch {
    return [];
  }
  const snapshots = await Promise.all(
    files
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => {
        try {
          const value: unknown = JSON.parse(await readFile(join(runsRoot, file), 'utf8'));
          return isSnapshot(value) ? value : undefined;
        } catch {
          return undefined;
        }
      }),
  );
  return snapshots.filter((snapshot): snapshot is PersistedWorkflowRunSnapshot => !!snapshot);
}

function phaseGlyph(status: string): string {
  if (status === 'completed') return '✓';
  if (status === 'failed') return '✗';
  if (status === 'running') return '…';
  if (status === 'stopped') return '◼';
  return '·';
}

function renderRun(run: ResolvedRun, now: number): string {
  const { snapshot } = run;
  const done = snapshot.phases.filter((phase) => phase.status === 'completed').length;
  const name = snapshot.workflow?.name ?? 'workflow';
  const stale = run.stale ? ' · stale (engine gone?)' : '';
  return `${snapshot.id} ${name} ${snapshot.status} ${done}/${snapshot.phases.length} phases · updated ${formatAge(run.updatedAt, now)}${stale}`;
}

export function registerWorkflowStatusTool(pi: ExtensionAPI, options: WorkflowStatusOptions = {}): void {
  const runsRoot = options.runsRoot ?? WORKFLOW_RUNS_ROOT;
  const rpc = options.rpc ?? SubagentWorkflowRpc.fromPi(pi);
  const now = options.now ?? Date.now;

  pi.registerTool({
    name: 'workflow_status',
    label: 'Workflow Status',
    description: 'Read live or persisted workflow run progress. Omit id for all runs; pass id for a phase checklist.',
    promptSnippet: 'Check a background workflow run: current status and phase checklist',
    promptGuidelines: [
      'Call workflow_status after launching a background workflow to inspect its progress.',
      'It is read-only and works after a Pi restart from mirrored run snapshots.',
    ],
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: 'Workflow run id. Omit to list all known runs.' })),
    }),
    async execute(_toolCallId, params) {
      const current = now();
      let live: PersistedWorkflowRunSnapshot[] = [];
      try {
        const result = await rpc.status(params.id);
        const snapshots = Array.isArray(result) ? result : [result];
        live = snapshots.filter(isSnapshot);
      } catch {
        // The persisted mirror is deliberately the recovery path when the engine is unavailable.
      }

      let runs: ResolvedRun[];
      if (live.length > 0) {
        runs = live.map((snapshot) => {
          const timestamp = updatedAt(snapshot, current);
          return { snapshot, source: 'rpc' as const, updatedAt: timestamp, stale: false };
        });
      } else {
        const snapshots = await loadRunFiles(runsRoot);
        runs = snapshots
          .filter((snapshot) => !params.id || snapshot.id === params.id)
          .map((snapshot) => {
            const timestamp = updatedAt(snapshot, current);
            return { snapshot, source: 'file' as const, updatedAt: timestamp, stale: isStale(snapshot, timestamp, current) };
          })
          .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      }

      const lines = runs.map((run) => renderRun(run, current));
      if (params.id && runs.length === 1) {
        lines.push(...runs[0]!.snapshot.phases.map((phase) => `  ${phaseGlyph(phase.status)} ${phase.label} [${phase.status}]`));
      }
      const text = lines.length
        ? lines.join('\n')
        : params.id
          ? `Workflow run not found: ${params.id}`
          : 'No workflow runs found.';
      return {
        content: [{ type: 'text' as const, text }],
        details: {
          source: runs[0]?.source ?? 'none',
          runs: runs.map((run) => ({ ...run.snapshot, updatedAt: run.updatedAt, stale: run.stale })),
        },
      };
    },
    renderCall(args, theme) {
      const id = (args as { id?: string }).id;
      let content = theme.fg('toolTitle', theme.bold('workflow_status'));
      if (id) content += ` ${theme.fg('muted', id)}`;
      return new Text(content, 0, 0);
    },
    renderResult(result, _options, theme) {
      const details = result.details as { runs?: PersistedWorkflowRunSnapshot[] } | undefined;
      const run = details?.runs?.[0];
      return new Text(
        theme.fg('toolTitle', run ? `${run.id} ` : 'workflow ') + theme.fg('muted', run?.status ?? 'no runs'),
        0,
        0,
      );
    },
  });
}
