/**
 * Pure utility functions for plan mode.
 *
 * Command sandboxing is delegated to @dreki-gg/pi-command-sandbox.
 */

import { isSafeCommand as baseSafeCommand } from '@dreki-gg/pi-command-sandbox';
import { resolve, sep } from 'node:path';
import { PLANS_ROOT, WORKFLOW_DRAFTS_ROOT } from './ledger.js';

/** Escape a literal string for embedding in a RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if a command is safe for plan mode.
 *
 * Delegates to the shared command sandbox with a custom allow rule
 * for `mkdir -p <plans-root>/` (planner needs to create plan directories).
 */
export function isSafeCommand(command: string, plansRoot: string = PLANS_ROOT): boolean {
  return baseSafeCommand(command, {
    allowCommand: (cmd) => isMkdirPlans(cmd, plansRoot),
  });
}

/** Allow mkdir only for paths inside the plans root. */
function isMkdirPlans(command: string, plansRoot: string): boolean {
  const root = escapeRegExp(plansRoot.replace(/\/+$/, ''));
  return new RegExp(`^\\s*mkdir\\s+(-p\\s+)?${root}(\\/|\\\\|\\s|$)`).test(command);
}

/**
 * Check if a file path is inside the plans root directory.
 *
 * Accepts both relative (<plans-root>/foo) and absolute paths containing the
 * plans root as a path-segment sequence.
 */
export function isPlanPath(filePath: string, plansRoot: string = PLANS_ROOT): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const root = escapeRegExp(plansRoot.replace(/\/+$/, ''));
  return new RegExp(`(?:^|/)${root}/`).test(normalized);
}

/** Check if a file path is inside the workflow drafts root directory. */
export function isWorkflowDraftPath(filePath: string, draftsRoot: string = WORKFLOW_DRAFTS_ROOT): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const root = escapeRegExp(draftsRoot.replace(/\/+$/, ''));
  return new RegExp(`(?:^|/)${root}/`).test(normalized);
}

const WORKFLOW_DRAFT_NAME = /^[a-z][a-z0-9-]{0,62}$/;

/** Resolve a bare draft name or an explicit draft path without permitting root escapes. */
export function resolveWorkflowDraftFile(input: string, draftsRoot: string = WORKFLOW_DRAFTS_ROOT): string {
  const root = resolve(draftsRoot);
  const isBareName = !input.includes('/') && !input.includes('\\');
  // Agents often pass the filename they just wrote ("my-run.json"); treat it as the bare name.
  const bareName = isBareName && input.endsWith('.json') ? input.slice(0, -'.json'.length) : input;
  const path = isBareName ? resolve(root, `${bareName}.json`) : resolve(input);
  if (!path.startsWith(`${root}${sep}`)) {
    throw new Error('Workflow draft path escapes its configured drafts folder.');
  }
  const fileName = path.slice(root.length + 1);
  if (!fileName.endsWith('.json') || fileName.includes(sep) || !WORKFLOW_DRAFT_NAME.test(fileName.slice(0, -'.json'.length))) {
    throw new Error('Workflow draft name must be kebab-case and use a .json file.');
  }
  return path;
}

// Plan name / task id helpers (`toKebabCase`, `nextTaskId`) now live in
// `@dreki-gg/taskman`.

// ── /workflow argument parsing ──────────────────────────────────────────────

export type WorkflowCommand =
  | { kind: 'toggle' }
  | { kind: 'task'; task: string }
  | { kind: 'status' }
  | { kind: 'stop' }
  | { kind: 'resume' }
  | { kind: 'save'; scope: 'project' | 'user'; name?: string }
  | { kind: 'run'; scope: 'project' | 'user'; name?: string };

const WORKFLOW_NAME = /^[a-z][a-z0-9-]{0,62}$/;

function isScope(token: string | undefined): token is 'project' | 'user' {
  return token === 'project' || token === 'user';
}

/**
 * Parse `/workflow` arguments. Subcommands are recognized ONLY when the whole
 * argument string matches their exact grammar; anything else — including
 * prose that happens to start with "run" or "save" — is a freeform design
 * task. This keeps `/workflow run a 2-phase smoke: …` from being read as
 * `run` + saved-workflow name "a".
 */
export function parseWorkflowCommand(args: string | undefined): WorkflowCommand {
  const trimmed = args?.trim() ?? '';
  if (!trimmed) return { kind: 'toggle' };
  const [head, ...rest] = trimmed.split(/\s+/);

  if ((head === 'status' || head === 'stop' || head === 'resume') && rest.length === 0) return { kind: head };

  if (head === 'run') {
    if (rest.length === 0) return { kind: 'run', scope: 'project' };
    if (rest.length === 1 && WORKFLOW_NAME.test(rest[0]!)) return { kind: 'run', scope: 'project', name: rest[0] };
    if (rest.length === 2 && isScope(rest[0]) && WORKFLOW_NAME.test(rest[1]!)) {
      return { kind: 'run', scope: rest[0], name: rest[1] };
    }
    return { kind: 'task', task: trimmed };
  }

  if (head === 'save') {
    if (rest.length === 0) return { kind: 'save', scope: 'project' };
    if (rest.length === 1 && isScope(rest[0])) return { kind: 'save', scope: rest[0] };
    if (rest.length === 1 && WORKFLOW_NAME.test(rest[0]!)) return { kind: 'save', scope: 'project', name: rest[0] };
    if (rest.length === 2 && isScope(rest[0]) && WORKFLOW_NAME.test(rest[1]!)) {
      return { kind: 'save', scope: rest[0], name: rest[1] };
    }
    return { kind: 'task', task: trimmed };
  }

  return { kind: 'task', task: trimmed };
}
