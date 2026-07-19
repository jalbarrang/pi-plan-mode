/**
 * Plan-mode types.
 *
 * Engine record/value types now live in `@dreki-gg/taskman` and are re-exported
 * here so the rest of the extension keeps importing from `./types.js`. The
 * pi-session-only types (`PersistedState`) stay local.
 */

export type {
  TaskStatus,
  TaskOrigin,
  PlanStatus,
  InitiativeStatus,
  TaskRecord,
  TaskMeta,
  PlanData,
  ThinkingLevel,
  ExecPendingConfig,
} from '@dreki-gg/taskman';

import type { PlanData } from '@dreki-gg/taskman';

/** Mutually exclusive extension phase persisted with the Pi session. */
export type PlanModePhase = 'idle' | 'plan' | 'execute' | 'workflow';

export interface WorkflowSessionState {
  /** Model-authored draft, revalidated before every launch or save. */
  draft?: unknown;
  /** Most recent background run in the current Pi process. */
  runId?: string;
}

export interface PersistedState {
  /** Canonical phase; absent from sessions persisted by pre-workflow releases. */
  phase?: PlanModePhase;
  /** Legacy compatibility fields. */
  planEnabled?: boolean;
  executing?: boolean;
  planDir: string | undefined;
  plan: PlanData | undefined;
  executionStartIdx: number | undefined;
  workflow?: WorkflowSessionState;
  /** Active toolset snapshotted when a mode was entered from idle; restored on exit. */
  preModeActiveTools?: string[];
}
