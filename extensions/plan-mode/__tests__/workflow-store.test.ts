import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkflow, saveWorkflow, workflowFileName, workflowPath } from '../workflow/store.js';
import type { WorkflowSpec } from '../workflow/spec.js';

let root: string;
const workflow: WorkflowSpec = {
  name: 'audit-routes',
  description: 'Audit routes.',
  task: 'Audit routes.',
  chain: [{ agent: 'scout', task: 'Find routes.' }],
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workflow-store-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('workflow store', () => {
  const roots = () => ({ project: join(root, 'project'), user: join(root, 'user') });

  test('writes and reloads a project workflow', async () => {
    const path = await saveWorkflow(roots(), 'project', workflow);
    expect(path).toBe(workflowPath(roots(), 'project', workflow.name));
    await expect(loadWorkflow(roots(), 'project', workflow.name)).resolves.toEqual(workflow);
  });

  test('refuses to silently overwrite a saved workflow', async () => {
    await saveWorkflow(roots(), 'user', workflow);
    await expect(saveWorkflow(roots(), 'user', workflow)).rejects.toThrow('already exists');
  });

  test('rejects traversal and non-kebab names before constructing a path', () => {
    expect(() => workflowFileName('../escape')).toThrow('kebab-case');
    expect(() => workflowPath(roots(), 'project', 'also/escape')).toThrow('kebab-case');
  });
});
