import { describe, expect, test } from 'bun:test';
import { validateWorkflowSpec, workflowSummary, workflowTable } from '../workflow/spec.js';

const validWorkflow = {
  name: 'audit-routes',
  description: 'Audit route authentication in parallel.',
  task: 'Audit authentication.',
  chain: [
    {
      agent: 'scout',
      task: 'Return JSON with { "files": [] }.',
      as: 'targets',
    },
    {
      expand: { from: 'targets', path: '/files', item: 'target', maxItems: 4 },
      parallel: { agent: 'reviewer', task: 'Review {target.path}.' },
      collect: { as: 'reviews' },
      concurrency: 2,
    },
  ],
};

describe('validateWorkflowSpec', () => {
  test('normalizes a bounded dynamic fan-out and counts its maximum agents', () => {
    const result = validateWorkflowSpec(validWorkflow);
    expect(result.valid).toBe(true);
    expect(result.maximumAgentCount).toBe(5);
    expect(result.phases).toEqual(['scout', 'Phase 2']);
    expect(workflowSummary(result.normalized!, result.maximumAgentCount!)).toContain('Maximum agents: 5');
  });

  test('workflowTable renders one row per agent without dumping JSON', () => {
    const withParallel = structuredClone(validWorkflow) as typeof validWorkflow & { chain: unknown[] };
    withParallel.chain.push({
      parallel: [
        { agent: 'reviewer-a', task: 'Check styles.', as: 'styles' },
        { agent: 'reviewer-b', task: 'Check types.' },
      ],
      label: 'Final review',
    });
    const result = validateWorkflowSpec(withParallel);
    expect(result.valid).toBe(true);
    const table = workflowTable(result.normalized!);
    const lines = table.split('\n');
    // header + divider + scout + fan-out + two parallel children
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatch(/#\s+Phase\s+Agent\s+Output\s+Task/);
    expect(table).toContain('reviewer ×≤4');
    expect(table).toContain('reviews');
    expect(table).toContain('Final review');
    expect(table).toContain('reviewer-b');
    expect(table).not.toContain('"chain"');
  });

  test('workflowTable truncates long tasks to keep the dialog narrow', () => {
    const workflow = structuredClone(validWorkflow);
    workflow.chain[0]!.task = `Return JSON. ${'x'.repeat(200)}`;
    const result = validateWorkflowSpec(workflow);
    const table = workflowTable(result.normalized!);
    const longest = Math.max(...table.split('\n').map((line) => line.length));
    expect(longest).toBeLessThanOrEqual(110);
    expect(table).toContain('…');
  });

  test('rejects an unbounded fan-out', () => {
    const workflow = structuredClone(validWorkflow);
    delete (workflow.chain[1] as { expand: { maxItems?: number } }).expand.maxItems;
    const result = validateWorkflowSpec(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('maxItems');
  });

  test('rejects an output reference before it is produced', () => {
    const workflow = structuredClone(validWorkflow);
    (workflow.chain[1] as { expand: { from: string } }).expand.from = 'unknown';
    const result = validateWorkflowSpec(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('earlier named output');
  });

  test('rejects a static workflow that can exceed the agent cap', () => {
    const workflow = {
      name: 'too-many',
      description: 'Too many agents.',
      task: 'Audit.',
      chain: [{ parallel: Array.from({ length: 101 }, () => ({ agent: 'scout', task: 'Read one file.' })) }],
    };
    const result = validateWorkflowSpec(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('at most 100 agents');
  });

  test('rejects prototype-pollution output keys', () => {
    const workflow = structuredClone(validWorkflow);
    (workflow.chain[0] as { as: string }).as = '__proto__';
    const result = validateWorkflowSpec(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('identifier');
  });
});
