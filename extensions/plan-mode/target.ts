/**
 * Resolve an optional external `target` working directory for the write tools
 * (submit_plan / revise_plan / add_task).
 *
 * The use-case: while working in repo A you discover a gap in package B (which
 * you author) and want to file the plan straight into B's plan ledger so it
 * becomes a first-class local plan there. The `target` points at B's repo
 * root (NOT its ledger dir) — B's own `.taskmanrc` decides where the ledger
 * lives (default `.taskman/plans`).
 *
 * Returns `undefined` when no target is given (caller uses the default,
 * cwd-bound runtime). When a target is given it is expanded (`~`), resolved to
 * an absolute path, and validated to be an existing directory — a missing or
 * non-directory target throws so we never silently create a ledger inside a
 * typo'd path.
 */

import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

/** Expand a leading `~` / `~/` to the user's home directory. */
function expandHome(input: string): string {
  if (input === '~') return homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return resolve(homedir(), input.slice(2));
  }
  return input;
}

/**
 * Resolve and validate an external target directory.
 *
 * @returns the absolute target dir, or `undefined` when `target` is empty/absent.
 * @throws  when the resolved path does not exist or is not a directory.
 */
export async function resolvePlanTarget(target?: string): Promise<string | undefined> {
  const trimmed = target?.trim();
  if (!trimmed) return undefined;

  const expanded = expandHome(trimmed);
  const absolute = isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);

  let stats;
  try {
    stats = await stat(absolute);
  } catch {
    throw new Error(
      `target directory does not exist: ${absolute}. Pass the repo root of the project whose plan ledger should receive this plan.`,
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(`target is not a directory: ${absolute}. Pass the repo root, not a file.`);
  }
  return absolute;
}

/**
 * Verify that an external-target write actually landed under `targetLedger`
 * (the ABSOLUTE ledger folder of the target repo, e.g. from
 * `resolveTargetLedger`).
 *
 * Routing to an external root relies on the loaded `@dreki-gg/taskman` honoring
 * the `root` argument to `makePlanRuntime`. An OLD/stale taskman build silently
 * ignores it and writes to the current working directory instead — reporting
 * success while misfiling the plan. This converts that silent fallback into a
 * loud, actionable failure.
 *
 * @throws when `<targetLedger>/<planDir>/tasks.jsonl` was not created.
 */
export async function assertTargetReceived(targetLedger: string, planDir: string): Promise<void> {
  const marker = resolve(targetLedger, planDir, 'tasks.jsonl');
  let body: string;
  try {
    body = await readFile(marker, 'utf-8');
  } catch {
    throw staleTargetError(targetLedger, marker);
  }
  if (body.length === 0) throw staleTargetError(targetLedger, marker);
}

/**
 * Like {@link assertTargetReceived} but for an append: confirm the freshly
 * written `taskId` is actually present in the target plan's tasks file. Reads
 * the file directly (not via a runtime) so a stale taskman cannot mask the
 * fallback by reading from cwd.
 */
export async function assertTargetTaskAppended(
  targetLedger: string,
  planDir: string,
  taskId: string,
): Promise<void> {
  const marker = resolve(targetLedger, planDir, 'tasks.jsonl');
  let body = '';
  try {
    body = await readFile(marker, 'utf-8');
  } catch {
    throw staleTargetError(targetLedger, marker);
  }
  if (!body.includes(`"${taskId}"`)) throw staleTargetError(targetLedger, marker);
}

function staleTargetError(targetLedger: string, marker: string): Error {
  return new Error(
    `External-target write did not land in ${targetLedger} (${marker} missing or unchanged). ` +
      'The loaded @dreki-gg/taskman build does not support external targets (root param) — ' +
      'restart pi so it reloads the rebuilt taskman, then retry. ' +
      "Note: the write may have gone to the current project's plan ledger instead — check and clean up there.",
  );
}
