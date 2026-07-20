import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
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

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function draftsRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'submit-workflow-'));
  temporaryDirectories.push(directory);
  return join(directory, 'workflows');
}

interface CapturedTool {
  execute: (
    id: string,
    params: { file: string },
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{ content: Array<{ text: string }>; details?: unknown; isError?: boolean }>;
}

function setup(choices: string[], root: string, options: { editor?: string; launchError?: Error } = {}) {
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
  registerSubmitWorkflowTool(pi as never, launcher, { onDraft: (draft) => drafts.push(draft) }, { draftsRoot: root });
  const ctx = {
    hasUI: true,
    ui: {
      select: async () => choices.shift(),
      editor: async () => options.editor,
    },
  };
  return { tool: tool!, ctx, drafts, launches };
}

async function writeDraft(root: string, name: string, contents: string = JSON.stringify(workflow)): Promise<string> {
  const path = join(root, `${name}.json`);
  await mkdir(root, { recursive: true });
  await writeFile(path, contents, { encoding: 'utf8' });
  return path;
}

describe('submit_workflow', () => {
  test('resolves a bare draft name within the injected drafts root', async () => {
    const root = await draftsRoot();
    const path = await writeDraft(root, 'audit-routes');
    const { tool, ctx, launches } = setup(['Run workflow'], root);
    const result = await tool.execute('call', { file: 'audit-routes' }, undefined, undefined, ctx);
    expect(result.content[0]?.text).toContain('wf_test');
    expect(launches).toEqual([workflow]);
    expect(path).toBe(resolve(root, 'audit-routes.json'));
  });

  test('reports the resolved path when the draft file is missing', async () => {
    const root = await draftsRoot();
    const { tool, ctx } = setup([], root);
    const result = await tool.execute('call', { file: 'missing-draft' }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(resolve(root, 'missing-draft.json'));
  });

  test('rejects invalid JSON in a draft file', async () => {
    const root = await draftsRoot();
    await writeDraft(root, 'audit-routes', '{not json');
    const { tool, ctx, launches } = setup([], root);
    const result = await tool.execute('call', { file: 'audit-routes' }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('unable to read workflow draft');
    expect(launches).toEqual([]);
  });

  test('rejects a path escape', async () => {
    const root = await draftsRoot();
    const { tool, ctx } = setup([], root);
    const result = await tool.execute('call', { file: '../evil' }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('escapes');
  });

  test('runs only the user-approved validated workflow', async () => {
    const root = await draftsRoot();
    await writeDraft(root, 'audit-routes');
    const { tool, ctx, drafts, launches } = setup(['Run workflow'], root);
    const result = await tool.execute('call', { file: 'audit-routes' }, undefined, undefined, ctx);
    expect(result.content[0]?.text).toContain('wf_test');
    expect(drafts).toEqual([workflow]);
    expect(launches).toEqual([workflow]);
  });

  test('fails closed when interactive approval is unavailable', async () => {
    const root = await draftsRoot();
    const { tool } = setup([], root);
    const result = await tool.execute('call', { file: 'audit-routes' }, undefined, undefined, { hasUI: false });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('approval is unavailable');
  });

  test('writes edited JSON back to the draft file before launch', async () => {
    const root = await draftsRoot();
    const path = await writeDraft(root, 'audit-routes');
    const edited = { ...workflow, description: 'Edited audit.', task: 'Edited audit.' };
    const { tool, ctx, launches } = setup(['Edit JSON', 'Run workflow'], root, { editor: JSON.stringify(edited) });
    const result = await tool.execute('call', { file: 'audit-routes' }, undefined, undefined, ctx);
    expect(result.content[0]?.text).toContain('wf_test');
    expect(launches).toEqual([edited]);
    expect(await readFile(path, 'utf8')).toBe(`${JSON.stringify(edited, null, 2)}\n`);
  });

  test('revalidates edited JSON before launch', async () => {
    const root = await draftsRoot();
    await writeDraft(root, 'audit-routes');
    const { tool, ctx, launches } = setup(['Edit JSON'], root, { editor: '{"name":"bad","chain":[]}' });
    const result = await tool.execute('call', { file: 'audit-routes' }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Workflow rejected');
    expect(launches).toHaveLength(0);
  });

  test('does not launch when the user cancels', async () => {
    const root = await draftsRoot();
    await writeDraft(root, 'audit-routes');
    const { tool, ctx, launches } = setup(['Cancel'], root);
    const result = await tool.execute('call', { file: 'audit-routes' }, undefined, undefined, ctx);
    expect((result.details as { cancelled?: boolean }).cancelled).toBe(true);
    expect(launches).toHaveLength(0);
  });
});
