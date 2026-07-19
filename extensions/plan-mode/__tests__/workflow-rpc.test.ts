import { describe, expect, test } from 'bun:test';
import { SubagentWorkflowRpc, SubagentWorkflowUnavailableError, type RpcBus } from '../workflow/subagents-rpc.js';
import type { WorkflowSpec } from '../workflow/spec.js';

const workflow: WorkflowSpec = {
  name: 'audit-routes',
  description: 'Audit routes.',
  task: 'Audit routes.',
  chain: [{ agent: 'scout', task: 'Find routes.' }],
};

function createBus(): RpcBus {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();
  return {
    on(topic, listener) {
      const entries = listeners.get(topic) ?? [];
      entries.push(listener);
      listeners.set(topic, entries);
      return () => listeners.set(topic, (listeners.get(topic) ?? []).filter((entry) => entry !== listener));
    },
    emit(topic, payload) {
      for (const listener of listeners.get(topic) ?? []) listener(payload);
      if (topic !== 'subagents:rpc:v1:request') return;
      const request = payload as { requestId: string; method: string };
      const reply = `subagents:rpc:v1:reply:${request.requestId}`;
      const data = request.method === 'ping' ? { available: true } : { id: 'wf_test' };
      for (const listener of listeners.get(reply) ?? []) {
        listener({ version: 1, requestId: request.requestId, success: true, data });
      }
    },
  };
}

describe('SubagentWorkflowRpc', () => {
  test('correlates a synchronous engine reply with the launch request', async () => {
    const rpc = new SubagentWorkflowRpc(createBus());
    await expect(rpc.ping()).resolves.toBeUndefined();
    await expect(rpc.spawn(workflow)).resolves.toEqual({ id: 'wf_test' });
  });

  test('fails with an actionable install error when no bridge is registered', async () => {
    const rpc = new SubagentWorkflowRpc(undefined, 1);
    await expect(rpc.ping()).rejects.toBeInstanceOf(SubagentWorkflowUnavailableError);
  });
});
