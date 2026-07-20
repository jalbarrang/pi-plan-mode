import { describe, expect, test } from 'bun:test';
import { PlanModeState } from '../state.js';
import { WorkflowModeController, type WorkflowStatusUi } from '../workflow/controller.js';
import type { SubagentWorkflowRpc, WorkflowRunSnapshot } from '../workflow/subagents-rpc.js';

const workflow = {
  name: 'audit-routes',
  description: 'Audit routes.',
  task: 'Audit routes.',
  chain: [
    { agent: 'scout', task: 'Find routes.' },
    { agent: 'worker', task: 'Summarize.' },
  ],
};

function snapshot(overrides: Partial<WorkflowRunSnapshot>): WorkflowRunSnapshot {
  return {
    id: 'wf_test',
    status: 'running',
    phases: [
      { label: 'scout', status: 'completed', output: 'routes found' },
      { label: 'worker', status: 'running' },
    ],
    ...overrides,
  };
}

function setup(snapshots: Array<WorkflowRunSnapshot | WorkflowRunSnapshot[]>) {
  const statuses: Array<string | undefined> = [];
  const notifications: string[] = [];
  const messages: Array<{ content: string }> = [];
  const rpc = {
    ping: async () => {},
    spawn: async () => ({ id: 'wf_test' }),
    status: async () => {
      if (snapshots.length === 0) throw new Error('no more snapshots');
      return snapshots.length > 1 ? snapshots.shift()! : snapshots[0]!;
    },
    stop: async () => {},
    resume: async () => ({ id: 'wf_test' }),
  } as unknown as SubagentWorkflowRpc;
  const pi = {
    appendEntry: () => {},
    sendMessage: (message: { content: string }) => messages.push(message),
  };
  const ui: WorkflowStatusUi = {
    setStatus: (_key, text) => statuses.push(text),
    notify: (message) => notifications.push(message),
  };
  const state = new PlanModeState();
  const controller = new WorkflowModeController(state, pi as never, rpc);
  return { controller, ui, statuses, notifications, messages, state };
}

describe('workflow controller ambient status', () => {
  test('renders running progress in the status bar', async () => {
    const { controller, ui, statuses } = setup([snapshot({})]);
    controller.attachUI(ui);
    await controller.launch(workflow);
    expect(statuses.at(-1)).toBe('⚙ wf 1/2 worker');
  });

  test('announces a watcher-observed completion with the final output snippet', async () => {
    const { controller, ui, statuses, messages } = setup([
      snapshot({}),
      snapshot({
        status: 'completed',
        phases: [
          { label: 'scout', status: 'completed', output: 'routes found' },
          { label: 'worker', status: 'completed', output: 'all done' },
        ],
      }),
    ]);
    controller.attachUI(ui);
    await controller.launch(workflow); // consumes the running snapshot
    await controller.pollOnce(); // observes the terminal snapshot
    expect(statuses.at(-1)).toBe('✓ wf completed 2/2');
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toContain('Background workflow completed');
    expect(messages[0]!.content).toContain('all done');
  });

  test('restoring a session with an already-finished run stays quiet', async () => {
    const { controller, ui, statuses, messages, state } = setup([
      snapshot({ status: 'completed', phases: [{ label: 'scout', status: 'completed' }, { label: 'worker', status: 'completed' }] }),
    ]);
    state.workflow.runId = 'wf_test'; // restored from a previous session
    controller.attachUI(ui);
    await controller.pollOnce();
    expect(statuses.at(-1)).toBe('✓ wf completed 2/2'); // footer still informs
    expect(messages).toHaveLength(0); // but nothing is injected into the conversation
  });

  test('a failed run announces the error', async () => {
    const { controller, ui, messages, notifications } = setup([
      snapshot({}),
      snapshot({
        status: 'failed',
        error: 'Agent "worker" exited 1.',
        phases: [
          { label: 'scout', status: 'completed' },
          { label: 'worker', status: 'failed' },
        ],
      }),
    ]);
    controller.attachUI(ui);
    await controller.launch(workflow);
    await controller.pollOnce();
    expect(notifications.at(-1)).toContain('failed');
    expect(messages[0]!.content).toContain('Agent "worker" exited 1.');
  });

  test('an engine that no longer knows the run clears the indicator', async () => {
    const { controller, ui, statuses, state } = setup([[]]);
    state.workflow.runId = 'wf_test';
    controller.attachUI(ui);
    await controller.pollOnce();
    expect(statuses.at(-1)).toBeUndefined();
  });
});
