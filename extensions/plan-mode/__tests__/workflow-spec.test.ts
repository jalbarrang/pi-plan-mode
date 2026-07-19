import { describe, expect, test } from 'bun:test';
import { validateWorkflowSpec, workflowSummary } from '../workflow/spec.js';

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
