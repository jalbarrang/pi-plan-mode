import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerWorkflowStatusTool } from '../tools/workflow-status.js';
import type { WorkflowRunSnapshot } from '../workflow/subagents-rpc.js';

const NOW = Date.parse('2026-01-01T00:01:00.000Z');
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function snapshot(overrides: Partial<WorkflowRunSnapshot> = {}): WorkflowRunSnapshot {
  return {
    id: 'wf_test',
    status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z',
    phases: [{ label: 'inspect', status: 'completed' }, { label: 'implement', status: 'running' }],
    ...overrides,
  };
}

function setup(options: Parameters<typeof registerWorkflowStatusTool>[1]) {
  let tool: { execute: (id: string, params: { id?: string }) => Promise<{ content: Array<{ text: string }>; details: unknown }> } | undefined;
  const pi = { registerTool: (registered: typeof tool) => (tool = registered) };
  registerWorkflowStatusTool(pi as never, options);
  return tool!;
}

describe('workflow_status tool', () => {
  test('uses live RPC status before persisted snapshots', async () => {
    const tool = setup({
      rpc: { status: async () => ({ ...snapshot(), workflow: { name: 'live-workflow' } }) },
      now: () => NOW,
    });

    const result = await tool.execute('call', { id: 'wf_test' });

    expect(result.content[0]!.text).toContain('wf_test live-workflow running 1/2 phases');
    expect(result.content[0]!.text).toContain('✓ inspect [completed]');
    expect(result.details).toMatchObject({ source: 'rpc' });
  });

  test('falls back to newest persisted snapshots when RPC is unavailable', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'workflow-status-'));
    directories.push(runsRoot);
    await writeFile(
      join(runsRoot, 'older.json'),
      JSON.stringify({ ...snapshot({ id: 'wf_old', status: 'completed' }), workflow: { name: 'older' }, updatedAt: '2026-01-01T00:00:10.000Z' }),
    );
    await writeFile(
      join(runsRoot, 'newer.json'),
      JSON.stringify({ ...snapshot({ id: 'wf_new', status: 'completed' }), workflow: { name: 'newer' }, updatedAt: '2026-01-01T00:00:40.000Z' }),
    );
    const tool = setup({ rpc: { status: async () => Promise.reject(new Error('engine gone')) }, runsRoot, now: () => NOW });

    const result = await tool.execute('call', {});

    expect(result.content[0]!.text.split('\n').map((line) => line.split(' ')[0])).toEqual(['wf_new', 'wf_old']);
    expect(result.details).toMatchObject({ source: 'file' });
  });

  test('flags stale running persisted snapshots', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'workflow-status-'));
    directories.push(runsRoot);
    await writeFile(
      join(runsRoot, 'stale.json'),
      JSON.stringify({ ...snapshot(), workflow: { name: 'stale-workflow' }, updatedAt: '2026-01-01T00:00:00.000Z' }),
    );
    const tool = setup({ rpc: { status: async () => [] }, runsRoot, now: () => NOW });

    const result = await tool.execute('call', { id: 'wf_test' });

    expect(result.content[0]!.text).toContain('stale (engine gone?)');
    expect(result.details).toMatchObject({ runs: [expect.objectContaining({ stale: true })] });
  });
});
