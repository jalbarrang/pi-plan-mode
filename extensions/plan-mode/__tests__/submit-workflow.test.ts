import { describe, expect, test } from 'bun:test';
import {
  registerSubmitWorkflowTool,
  type WorkflowLauncher,
} from '../tools/submit-workflow.js';

const workflow = {
  name: 'audit-routes',
  description: 'Audit routes.',
  task: 'Audit routes.',
  chain: [{ agent: 'scout', task: 'Find routes.' }],
};

interface CapturedTool {
  execute: (
    id: string,
    params: { workflow: unknown },
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{ content: Array<{ text: string }>; details?: unknown; isError?: boolean }>;
}

function setup(choices: string[], options: { editor?: string; launchError?: Error } = {}) {
  let tool: CapturedTool | undefined;
  const drafts: unknown[] = [];
  const launches: unknown[] = [];
  const launcher: WorkflowLauncher = {
    async launch(candidate) {
      launches.push(candidate);
      if (options.launchError) throw options.launchError;
      return 'wf_test';
    },
  };
  const pi = { registerTool: (candidate: CapturedTool) => (tool = candidate) };
  registerSubmitWorkflowTool(pi as never, launcher, { onDraft: (draft) => drafts.push(draft) });
  const ctx = {
    hasUI: true,
    ui: {
      select: async () => choices.shift(),
      editor: async () => options.editor,
    },
  };
  return { tool: tool!, ctx, drafts, launches };
}

describe('submit_workflow', () => {
  test('runs only the user-approved validated workflow', async () => {
    const { tool, ctx, drafts, launches } = setup(['Run workflow']);
    const result = await tool.execute('call', { workflow }, undefined, undefined, ctx);
    expect(result.content[0]?.text).toContain('wf_test');
    expect(drafts).toEqual([workflow]);
    expect(launches).toEqual([workflow]);
  });

  test('fails closed when interactive approval is unavailable', async () => {
    const { tool } = setup([]);
    const result = await tool.execute('call', { workflow }, undefined, undefined, { hasUI: false });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('approval is unavailable');
  });

  test('revalidates edited JSON before launch', async () => {
    const { tool, ctx, launches } = setup(['Edit JSON'], { editor: '{"name":"bad","chain":[]}' });
    const result = await tool.execute('call', { workflow }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Workflow rejected');
    expect(launches).toHaveLength(0);
  });

  test('does not launch when the user cancels', async () => {
    const { tool, ctx, launches } = setup(['Cancel']);
    const result = await tool.execute('call', { workflow }, undefined, undefined, ctx);
    expect((result.details as { cancelled?: boolean }).cancelled).toBe(true);
    expect(launches).toHaveLength(0);
  });
});
