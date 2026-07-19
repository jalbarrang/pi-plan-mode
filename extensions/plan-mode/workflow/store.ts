/** Persistent workflow storage compatible with pi-subagent project conventions. */

import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { WorkflowSpec } from './spec.js';
import { validateWorkflowSpec } from './spec.js';

export type WorkflowStoreScope = 'project' | 'user';

export interface WorkflowStoreRoots {
  project: string;
  user: string;
}

export function defaultWorkflowStoreRoots(cwd: string = process.cwd()): WorkflowStoreRoots {
  return {
    project: join(cwd, '.pi', 'chains'),
    user: join(homedir(), '.pi', 'agent', 'chains'),
  };
}

export function workflowFileName(name: string): string {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name)) {
    throw new Error('Workflow name must be kebab-case and cannot contain a path.');
  }
  return `${name}.chain.json`;
}

export function workflowPath(roots: WorkflowStoreRoots, scope: WorkflowStoreScope, name: string): string {
  const root = resolve(roots[scope]);
  const path = resolve(root, workflowFileName(name));
  if (!path.startsWith(`${root}${sep}`)) throw new Error('Workflow path escapes its configured store.');
  return path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Write atomically and refuse to replace a saved workflow without consent. */
export async function saveWorkflow(
  roots: WorkflowStoreRoots,
  scope: WorkflowStoreScope,
  workflow: WorkflowSpec,
  options: { overwrite?: boolean } = {},
): Promise<string> {
  const path = workflowPath(roots, scope, workflow.name);
  if (!options.overwrite && (await exists(path))) {
    throw new Error(`Workflow "${workflow.name}" already exists at ${path}. Choose a new name or explicitly replace it.`);
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(workflow, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
  return path;
}

export async function loadWorkflow(
  roots: WorkflowStoreRoots,
  scope: WorkflowStoreScope,
  name: string,
): Promise<WorkflowSpec> {
  const path = workflowPath(roots, scope, name);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read saved workflow at ${path}: ${message}`);
  }
  const validation = validateWorkflowSpec(parsed);
  if (!validation.valid || !validation.normalized) {
    throw new Error(`Saved workflow at ${path} is invalid: ${validation.errors.join(' ')}`);
  }
  return validation.normalized;
}
