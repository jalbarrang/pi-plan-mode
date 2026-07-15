import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { mkdir, writeFile as writeFileFs } from 'node:fs/promises';
import {
  resolvePlanTarget,
  assertTargetReceived,
  assertTargetTaskAppended,
} from '../target.js';
import { resolveTargetLedger } from '../ledger.js';
import { DEFAULT_PLANS_ROOT } from '@dreki-gg/taskman';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plan-target-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('resolvePlanTarget', () => {
  test('returns undefined for absent / empty / whitespace input', async () => {
    expect(await resolvePlanTarget(undefined)).toBeUndefined();
    expect(await resolvePlanTarget('')).toBeUndefined();
    expect(await resolvePlanTarget('   ')).toBeUndefined();
  });

  test('resolves an existing absolute directory', async () => {
    expect(await resolvePlanTarget(dir)).toBe(dir);
  });

  test('resolves a relative path against cwd', async () => {
    const rel = relative(process.cwd(), dir);
    expect(await resolvePlanTarget(rel)).toBe(dir);
  });

  test('expands a leading ~ to the home directory', async () => {
    expect(await resolvePlanTarget('~')).toBe(homedir());
  });

  test('throws when the target does not exist', async () => {
    await expect(resolvePlanTarget(join(dir, 'nope'))).rejects.toThrow(/does not exist/);
  });

  test('throws when the target is a file, not a directory', async () => {
    const file = join(dir, 'file.txt');
    await writeFile(file, 'x');
    await expect(resolvePlanTarget(file)).rejects.toThrow(/not a directory/);
  });
});

describe('resolveTargetLedger', () => {
  test('defaults to the taskman default plans root', () => {
    expect(resolveTargetLedger(dir)).toBe(join(dir, DEFAULT_PLANS_ROOT));
  });

  test("honours the target's .taskmanrc plans-root", async () => {
    await writeFile(join(dir, '.taskmanrc'), '{"plans-root": ".plans"}\n');
    expect(resolveTargetLedger(dir)).toBe(join(dir, '.plans'));
  });
});

describe('stale-target guards', () => {
  const ledger = () => join(dir, DEFAULT_PLANS_ROOT);

  test('assertTargetReceived throws when the target tasks file is absent', async () => {
    await expect(assertTargetReceived(ledger(), 'gap')).rejects.toThrow(
      /does not support external targets/,
    );
  });

  test('assertTargetReceived passes when the target tasks file exists', async () => {
    await mkdir(join(ledger(), 'gap'), { recursive: true });
    await writeFileFs(join(ledger(), 'gap', 'tasks.jsonl'), '{"_type":"meta"}\n');
    await expect(assertTargetReceived(ledger(), 'gap')).resolves.toBeUndefined();
  });

  test('assertTargetTaskAppended throws when the task id is not in the target file', async () => {
    await mkdir(join(ledger(), 'gap'), { recursive: true });
    await writeFileFs(join(ledger(), 'gap', 'tasks.jsonl'), '{"id":"t-001"}\n');
    await expect(assertTargetTaskAppended(ledger(), 'gap', 't-002')).rejects.toThrow(
      /external targets/,
    );
    await expect(assertTargetTaskAppended(ledger(), 'gap', 't-001')).resolves.toBeUndefined();
  });
});
