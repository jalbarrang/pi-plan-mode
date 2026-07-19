import { describe, expect, test } from 'bun:test';
import { PlanModeState } from '../state.js';
import { enterPlanMode, enterWorkflowMode, exitPlanMode, exitWorkflowMode, restoreIdleTools, startExecution } from '../phase-transitions.js';
import type { PlanData, TaskRecord } from '../types.js';

function makePi(activeTools: string[], allTools: string[] = activeTools) {
  const calls: string[][] = [];
  return {
    calls,
    pi: {
      getActiveTools: () => [...activeTools],
      getAllTools: () => allTools.map((name) => ({ name })),
      setActiveTools: (names: string[]) => calls.push([...names]),
      appendEntry: () => {},
    } as never,
  };
}

function makeCtx() {
  return {
    model: undefined,
    ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
    sessionManager: { getEntries: () => [] },
  } as never;
}

function makePlan(overrides?: Partial<PlanData>): PlanData {
  const task: TaskRecord = {
    _type: 'task',
    id: 't-001',
    description: 'Do work',
    details: 'Details',
    status: 'pending',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
  return {
    title: 'Test Plan',
    planName: 'test-plan',
    handoff: '# Handoff',
    tasks: [task],
    ...overrides,
  };
}

describe('PlanModeState', () => {
  test('keeps plan, execution, and workflow modes mutually exclusive', () => {
    const state = new PlanModeState();
    state.planEnabled = true;
    expect(state.phase).toBe('plan');
    expect(state.executing).toBe(false);

    state.executing = true;
    expect(state.phase).toBe('execute');
    expect(state.planEnabled).toBe(false);

    state.phase = 'workflow';
    expect(state.workflowEnabled).toBe(true);
    expect(state.planEnabled).toBe(false);
    expect(state.executing).toBe(false);
  });

  test('restores legacy plan and execution entries into the canonical phase', () => {
    const plan = makePlan();
    const planState = new PlanModeState();
    planState.restore([
      { type: 'custom', customType: 'plan-mode', data: { planEnabled: true, executing: false, planDir: 'test-plan', plan, executionStartIdx: undefined } },
    ]);
    expect(planState.phase).toBe('plan');

    const executionState = new PlanModeState();
    executionState.restore([
      { type: 'custom', customType: 'plan-mode', data: { planEnabled: false, executing: true, planDir: 'test-plan', plan, executionStartIdx: 4 } },
    ]);
    expect(executionState.phase).toBe('execute');
  });

  describe('idle toolset snapshot', () => {
    const IDLE_TOOLS = ['read', 'bash', 'subagent', 'questionnaire', 'submit_workflow', 'my_custom_tool'];

    test('exiting plan mode restores the toolset captured on entry, not EXEC_TOOLS', async () => {
      const state = new PlanModeState();
      const { pi, calls } = makePi(IDLE_TOOLS);
      const ctx = makeCtx();

      await enterPlanMode(state, pi, ctx);
      expect(state.preModeActiveTools).toEqual(IDLE_TOOLS);

      await exitPlanMode(state, pi, ctx);
      expect(calls.at(-1)).toEqual(IDLE_TOOLS);
      expect(state.preModeActiveTools).toBeUndefined();
    });

    test('exiting workflow mode restores the toolset captured on entry', async () => {
      const state = new PlanModeState();
      const { pi, calls } = makePi(IDLE_TOOLS);
      const ctx = makeCtx();

      enterWorkflowMode(state, pi, ctx);
      await exitWorkflowMode(state, pi, ctx);
      expect(calls.at(-1)).toEqual(IDLE_TOOLS);
    });

    test('plan→execute keeps the original idle snapshot across the transition', async () => {
      const state = new PlanModeState();
      const { pi } = makePi(IDLE_TOOLS);
      const ctx = makeCtx();

      await enterPlanMode(state, pi, ctx);
      await startExecution(state, pi, ctx); // must NOT recapture PLAN_TOOLS as the snapshot
      expect(state.preModeActiveTools).toEqual(IDLE_TOOLS);
    });

    test('restoreIdleTools falls back to every registered tool for legacy sessions', () => {
      const state = new PlanModeState(); // no snapshot persisted
      const { pi, calls } = makePi([], ['read', 'bash', 'edit', 'write', 'subagent', 'submit_workflow']);

      restoreIdleTools(state, pi);
      expect(calls.at(-1)).toEqual(['read', 'bash', 'edit', 'write', 'subagent', 'submit_workflow']);
    });

    test('snapshot round-trips through persistence entries', () => {
      const state = new PlanModeState();
      state.preModeActiveTools = IDLE_TOOLS;

      const restored = new PlanModeState();
      restored.restore([
        { type: 'custom', customType: 'plan-mode', data: { phase: 'execute', planDir: undefined, plan: undefined, executionStartIdx: undefined, preModeActiveTools: IDLE_TOOLS } },
      ]);
      expect(restored.preModeActiveTools).toEqual(IDLE_TOOLS);
    });
  });

  describe('exitPreservingPlan', () => {
    test('clears mode flags but keeps plan data when a plan was submitted', () => {
      const state = new PlanModeState();
      state.planEnabled = true;
      state.planDir = '.plans/test-plan';
      state.plan = makePlan();

      state.exitPreservingPlan();

      expect(state.planEnabled).toBe(false);
      expect(state.executing).toBe(false);
      expect(state.plan).toBeDefined();
      expect(state.planDir).toBe('.plans/test-plan');
    });

    test('fully resets when no plan was submitted', () => {
      const state = new PlanModeState();
      state.planEnabled = true;
      state.planDir = undefined;
      state.plan = undefined;

      state.exitPreservingPlan();

      expect(state.planEnabled).toBe(false);
      expect(state.plan).toBeUndefined();
      expect(state.planDir).toBeUndefined();
    });
  });
});
