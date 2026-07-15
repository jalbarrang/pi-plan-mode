import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chdir } from 'node:process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_PLANS_ROOT, makePlanRuntime, writeTasksJsonl, upsertPlanEntry } from '@dreki-gg/taskman';
import type { TaskMeta, TaskRecord } from '@dreki-gg/taskman';
import { registerRevisePlanTool } from '../tools/revise-plan.js';
import { registerAddTaskTool } from '../tools/add-task.js';

const now = '2026-05-27T12:00:00.000Z';

interface CapturedTool {
  execute: (
    id: string,
    params: Record<string, unknown>,
  ) => Promise<{ content?: Array<{ text: string }>; details?: unknown }>;
}

function captureTool(register: (pi: unknown) => void): CapturedTool {
  let tool: CapturedTool | undefined;
  register({ registerTool: (config: CapturedTool) => (tool = config) });
  return tool!;
}

/** Seed an in-progress plan with one done task into a target repo's ledger. */
async function seedPlan(targetDir: string, plansRoot: string = DEFAULT_PLANS_ROOT): Promise<void> {
  const io = makePlanRuntime(join(targetDir, plansRoot));
  const meta: TaskMeta = { _type: 'meta', title: 'Gap', plan_name: 'gap', created_at: now };
  const task: TaskRecord = {
    _type: 'task',
    id: 't-001',
    description: 'done work',
    details: '',
    status: 'done',
    origin: 'plan',
    created_at: now,
    updated_at: now,
  };
  await io(writeTasksJsonl('gap', meta, [task]));
  await io(upsertPlanEntry('gap', { status: 'in-progress', title: 'Gap' }));
}

const originalCwd = process.cwd();
let cwdDir: string;
let targetDir: string;

beforeEach(async () => {
  cwdDir = await mkdtemp(join(tmpdir(), 'plan-mode-ext-cwd-'));
  targetDir = await mkdtemp(join(tmpdir(), 'plan-mode-ext-target-'));
  chdir(cwdDir);
  await seedPlan(targetDir);
});
afterEach(async () => {
  chdir(originalCwd);
  await rm(cwdDir, { recursive: true, force: true });
  await rm(targetDir, { recursive: true, force: true });
});

describe('revise_plan — external target', () => {
  test('rewrites the plan in the target repo and does not pin session state', async () => {
    let pinned = false;
    const tool = captureTool((pi) =>
      registerRevisePlanTool(pi as never, makePlanRuntime(), {
        resolvePlan: async () => ({ plan: undefined, candidates: [] }),
        onPlanRevised: () => {
          pinned = true;
        },
      }),
    );

    const res = await tool.execute('c', {
      plan: 'gap',
      title: 'Gap (revised)',
      target: targetDir,
    });

    const manifest = await readFile(join(targetDir, DEFAULT_PLANS_ROOT, 'plans.jsonl'), 'utf-8');
    expect(manifest).toContain('Gap (revised)');
    expect(res.content?.[0]?.text).toMatch(/revised/);
    expect((res.details as { target?: string }).target).toBe(targetDir);
    expect(pinned).toBe(false);
  });
});

describe('add_task — external target', () => {
  test('appends a deferred task to the target plan, bypassing session callbacks', async () => {
    let sessionCalled = false;
    const tool = captureTool((pi) =>
      registerAddTaskTool(pi as never, {
        resolvePlan: async () => {
          sessionCalled = true;
          return { plan: undefined, candidates: [] };
        },
        onTaskAdded: () => {
          sessionCalled = true;
        },
      }),
    );

    const res = await tool.execute('c', {
      description: 'Fix the gap edge case',
      reason: 'found while dogfooding',
      plan: 'gap',
      target: targetDir,
    });

    const tasks = await readFile(join(targetDir, DEFAULT_PLANS_ROOT, 'gap', 'tasks.jsonl'), 'utf-8');
    expect(tasks).toContain('Fix the gap edge case');
    expect(tasks).toContain('deferred');
    expect(res.content?.[0]?.text).toMatch(/Captured follow-up t-002/);
    expect(sessionCalled).toBe(false);
  });

  test("honours the target repo's .taskmanrc plans-root", async () => {
    const rcTarget = await mkdtemp(join(tmpdir(), 'plan-mode-ext-rc-'));
    try {
      await writeFile(join(rcTarget, '.taskmanrc'), '{"plans-root": ".plans"}\n');
      await seedPlan(rcTarget, '.plans');

      const tool = captureTool((pi) =>
        registerAddTaskTool(pi as never, {
          resolvePlan: async () => ({ plan: undefined, candidates: [] }),
          onTaskAdded: () => {},
        }),
      );

      const res = await tool.execute('c', {
        description: 'Follow the rc',
        reason: 'ledger root comes from .taskmanrc',
        plan: 'gap',
        target: rcTarget,
      });

      const tasks = await readFile(join(rcTarget, '.plans', 'gap', 'tasks.jsonl'), 'utf-8');
      expect(tasks).toContain('Follow the rc');
      expect(res.content?.[0]?.text).toMatch(/Captured follow-up/);
    } finally {
      await rm(rcTarget, { recursive: true, force: true });
    }
  });

  test('soft-skips when the plan does not exist in the target', async () => {
    const tool = captureTool((pi) =>
      registerAddTaskTool(pi as never, {
        resolvePlan: async () => ({ plan: undefined, candidates: [] }),
        onTaskAdded: () => {},
      }),
    );

    const res = await tool.execute('c', {
      description: 'x',
      reason: 'y',
      plan: 'nonexistent',
      target: targetDir,
    });

    expect(res.content?.[0]?.text).toMatch(/plan not found/i);
    expect((res.details as { skipped?: boolean }).skipped).toBe(true);
  });
});
