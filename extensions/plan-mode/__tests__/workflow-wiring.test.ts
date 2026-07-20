import { describe, expect, test } from 'bun:test';
import planMode from '../index.js';
import { PLAN_TOOLS, EXEC_TOOLS, WORKFLOW_TOOLS } from '../constants.js';

describe('workflow root wiring', () => {
  test('registers the workflow command, approval tool, and lifecycle hooks once', () => {
    const commands: string[] = [];
    const tools: string[] = [];
    const events: string[] = [];
    const pi = {
      registerFlag: () => {},
      registerTool: (tool: { name: string }) => tools.push(tool.name),
      registerCommand: (name: string) => commands.push(name),
      registerShortcut: () => {},
      on: (event: string) => events.push(event),
    };
    planMode(pi as never);
    expect(commands).toContain('workflow');
    expect(tools).toContain('submit_workflow');
    expect(tools).toContain('workflow_status');
    expect(events).toContain('before_agent_start');
    expect(events).toContain('tool_call');
    expect(events).toContain('session_start');
  });

  test('workflow_status survives every mode tool-set (validator finding: plan/exec stripped it)', () => {
    expect(PLAN_TOOLS).toContain('workflow_status');
    expect(EXEC_TOOLS).toContain('workflow_status');
    expect(WORKFLOW_TOOLS).toContain('workflow_status');
  });

  test('blocks direct subagent launches and product writes while permitting workflow drafts', async () => {
    const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
    const events = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
    const pi = {
      registerFlag: () => {},
      registerTool: () => {},
      registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) =>
        commands.set(name, command),
      registerShortcut: () => {},
      on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => events.set(event, handler),
      setActiveTools: () => {},
      getActiveTools: () => [],
      getAllTools: () => [],
      appendEntry: () => {},
      sendUserMessage: () => {},
    };
    planMode(pi as never);
    const ctx = {
      ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
      model: undefined,
      sessionManager: { getEntries: () => [] },
    };
    await commands.get('workflow')?.handler('', ctx);

    const guard = events.get('tool_call')!;
    const subagent = await guard({ toolName: 'subagent', input: {} }, ctx);
    const workflowStatus = await guard({ toolName: 'workflow_status', input: {} }, ctx);
    const write = await guard({ toolName: 'write', input: { path: 'src/index.ts' } }, ctx);
    const draftWrite = await guard({ toolName: 'write', input: { path: '.taskman/workflows/audit-routes.json' } }, ctx);
    const draftEdit = await guard({ toolName: 'edit', input: { path: '.taskman/workflows/audit-routes.json' } }, ctx);
    expect(subagent).toMatchObject({ block: true });
    expect(workflowStatus).toBeUndefined();
    expect(write).toMatchObject({ block: true });
    expect((write as { reason: string }).reason).toContain('.taskman/workflows');
    expect(draftWrite).toBeUndefined();
    expect(draftEdit).toBeUndefined();
  });
});
