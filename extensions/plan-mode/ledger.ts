/**
 * Ledger-root resolution for the extension.
 *
 * The plans root is no longer hardcoded to `.plans/` — it is resolved once at
 * extension load via taskman's `resolveLedgerRoot()`, which honours a
 * `.taskmanrc` JSON file in the working directory (`{"plans-root": "<dir>"}`)
 * and defaults to `.taskman/plans`. Resolution is cwd-only by design (no
 * walk-up, no env var), matching the taskman CLI, so both tools always agree
 * on where the ledger lives.
 *
 * A malformed `.taskmanrc` throws at import time — a loud failure is better
 * than silently writing plans into the wrong directory.
 *
 * Storage programs (taskman >= 0.6) take ledger-relative paths (`<plan-name>/
 * tasks.jsonl`), so `PLANS_ROOT` is only needed to (a) build the runtime via
 * `makePlanRuntime(PLANS_ROOT)`, and (b) render user-facing paths.
 */

import { resolve } from 'node:path';
import { resolveLedgerRoot } from '@dreki-gg/taskman';

/** The ledger folder (contains `plans.jsonl` directly). May be relative to cwd. */
export const PLANS_ROOT: string = resolveLedgerRoot().root;

/** User-facing path for a plan/initiative directory inside the ledger. */
export function plansPath(...segments: string[]): string {
  return [PLANS_ROOT, ...segments].join('/');
}

/**
 * Resolve the ABSOLUTE ledger folder for an external target repo, honouring
 * that repo's own `.taskmanrc`. Used by the external-target write tools
 * (submit_plan / revise_plan / add_task) to build a target-scoped runtime.
 */
export function resolveTargetLedger(targetDir: string): string {
  return resolve(targetDir, resolveLedgerRoot(targetDir).root);
}
