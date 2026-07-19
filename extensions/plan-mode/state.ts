/**
 * Encapsulates all mutable plan-mode state with persistence helpers.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { PlanData, PersistedState, PlanModePhase, WorkflowSessionState } from './types.js';

export class PlanModeState {
  phase: PlanModePhase = 'idle';
  planDir: string | undefined;
  plan: PlanData | undefined;
  executionStartIdx: number | undefined;
  workflow: WorkflowSessionState = {};
  previousModel: { provider: string; id: string } | undefined;

  /** Compatibility facade for the existing plan controller. */
  get planEnabled(): boolean {
    return this.phase === 'plan';
  }

  set planEnabled(enabled: boolean) {
    if (enabled) {
      this.phase = 'plan';
    } else if (this.phase === 'plan') {
      this.phase = 'idle';
    }
  }

  /** Compatibility facade for the existing execution controller. */
  get executing(): boolean {
    return this.phase === 'execute';
  }

  set executing(executing: boolean) {
    if (executing) {
      this.phase = 'execute';
    } else if (this.phase === 'execute') {
      this.phase = 'idle';
    }
  }

  get workflowEnabled(): boolean {
    return this.phase === 'workflow';
  }

  persist(pi: ExtensionAPI): void {
    pi.appendEntry<PersistedState>('plan-mode', {
      phase: this.phase,
      // Keep writing legacy values so older extensions can safely resume the
      // established plan/execution workflow.
      planEnabled: this.planEnabled,
      executing: this.executing,
      planDir: this.planDir,
      plan: this.plan,
      executionStartIdx: this.executionStartIdx,
      workflow: this.workflow,
    });
  }

  restore(entries: Array<{ type: string; customType?: string; data?: PersistedState }>): void {
    const saved = entries.filter((e) => e.type === 'custom' && e.customType === 'plan-mode').pop();
    if (saved?.data) {
      this.phase =
        saved.data.phase ??
        (saved.data.executing ? 'execute' : saved.data.planEnabled ? 'plan' : this.phase);
      // planDir is ledger-relative (a bare plan name). Sessions persisted by
      // older versions stored `.plans/<name>` — normalize to the last segment.
      const savedDir = saved.data.planDir;
      this.planDir = savedDir ? (savedDir.replace(/\/+$/, '').split('/').pop() ?? savedDir) : this.planDir;
      this.plan = saved.data.plan ?? this.plan;
      this.executionStartIdx = saved.data.executionStartIdx ?? this.executionStartIdx;
      this.workflow = saved.data.workflow ?? this.workflow;
    }
  }

  reset(): void {
    this.phase = 'idle';
    this.planDir = undefined;
    this.plan = undefined;
    this.executionStartIdx = undefined;
    this.workflow = {};
  }

  /** Exit plan/execution mode but keep plan data for update_task tracking. */
  exitPreservingPlan(): void {
    this.phase = 'idle';
    this.executionStartIdx = undefined;
  }
}
