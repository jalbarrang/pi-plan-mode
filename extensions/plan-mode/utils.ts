/**
 * Pure utility functions for plan mode.
 *
 * Command sandboxing is delegated to @dreki-gg/pi-command-sandbox.
 */

import { isSafeCommand as baseSafeCommand } from '@dreki-gg/pi-command-sandbox';
import { PLANS_ROOT } from './ledger.js';

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

// Plan name / task id helpers (`toKebabCase`, `nextTaskId`) now live in
// `@dreki-gg/taskman`.
