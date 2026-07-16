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
 * Tool-specific verbs that `@hypabolic/pi-hypa` rewrites in place (output
 * reduction only — the command semantics are unchanged), emitted as
 * `hypa <verb> <args...>`.
 */
const HYPA_REWRITE_VERBS = ['git', 'docker', 'kubectl', 'dotnet'];

/**
 * Undo `@hypabolic/pi-hypa`'s bash-rewrite wrapping so the real underlying
 * command can be validated against the safe/destructive pattern lists.
 *
 * When the `pi-hypa` extension is installed, it rewrites every `bash` tool
 * call through `hypa rewrite --json` for output compression *before* this
 * extension's `tool_call` handler ever sees it. That rewrite produces one of:
 *
 *   - `hypa -c "<command>"`                    (GenericWrapper)
 *   - `hypa <git|docker|kubectl|dotnet> <args>` (tool-specific reducer)
 *
 * Neither form matches any safe-command pattern (they all anchor on the
 * original leading verb, e.g. `git`, `ls`), so without unwrapping, every
 * bash command would be blocked in plan mode whenever pi-hypa is active.
 * This is a best-effort textual unwrap, not a full shell parser — plan mode's
 * sandbox is a guardrail against accidental writes, not a hard security
 * boundary, so a conservative regex match is an acceptable trade-off.
 */
export function unwrapHypaWrapping(command: string): string {
  let result = command;

  // hypa -c "<command>" / hypa -c '<command>'  (GenericWrapper)
  result = result.replace(/\bhypa\s+-c\s+"((?:[^"\\]|\\.)*)"/g, (_match, inner: string) =>
    inner.replace(/\\(["\\])/g, '$1'),
  );
  result = result.replace(/\bhypa\s+-c\s+'((?:[^'\\]|\\.)*)'/g, (_match, inner: string) =>
    inner.replace(/\\(['\\])/g, '$1'),
  );

  // hypa -t <args...> / hypa raw <args...>  (explicit no-rewrite passthrough)
  result = result.replace(/\bhypa\s+(?:-t|raw)\s+/g, '');

  // hypa git|docker|kubectl|dotnet <args...>  (tool-specific output reducers)
  const verbAlternation = HYPA_REWRITE_VERBS.join('|');
  result = result.replace(new RegExp(`\\bhypa\\s+(${verbAlternation})\\b`, 'g'), '$1');

  return result;
}

/**
 * Check if a command is safe for plan mode.
 *
 * Delegates to the shared command sandbox with a custom allow rule
 * for `mkdir -p <plans-root>/` (planner needs to create plan directories).
 * Commands are first unwrapped from any `@hypabolic/pi-hypa` bash rewriting
 * so the sandbox validates the real command, not Hypa's wrapper.
 */
export function isSafeCommand(command: string, plansRoot: string = PLANS_ROOT): boolean {
  const unwrapped = unwrapHypaWrapping(command);
  return baseSafeCommand(unwrapped, {
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
