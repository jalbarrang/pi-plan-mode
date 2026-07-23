/**
 * Bounded, declarative workflow representation.
 *
 * The format is deliberately a subset of pi-subagent's orchestration model:
 * no arbitrary code, loops, filesystem access, or implicit unbounded fan-out.
 */

export interface WorkflowAgentStep {
  agent: string;
  task: string;
  label?: string;
  as?: string;
  model?: string;
  thinking?: string;
}

export interface WorkflowParallelStep {
  parallel: WorkflowAgentStep[];
  label?: string;
  concurrency?: number;
}

export interface WorkflowFanoutStep {
  expand: { from: string; path: string; item: string; maxItems: number };
  parallel: WorkflowAgentStep;
  collect: { as: string };
  label?: string;
  concurrency?: number;
}

export type WorkflowStep = WorkflowAgentStep | WorkflowParallelStep | WorkflowFanoutStep;

export interface WorkflowSpec {
  name: string;
  description: string;
  task: string;
  agentScope?: 'user' | 'project' | 'both';
  chain: WorkflowStep[];
}

export interface WorkflowValidation {
  valid: boolean;
  errors: string[];
  normalized?: WorkflowSpec;
  maximumAgentCount?: number;
  phases?: string[];
}

const NAME = /^[a-z][a-z0-9-]{0,62}$/;
const OUTPUT = /^[A-Za-z][A-Za-z0-9_-]*$/;
const RESERVED_OUTPUTS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_PHASES = 32;
const MAX_CONCURRENCY = 16;
const MAX_AGENTS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isOutputName(value: string): boolean {
  return OUTPUT.test(value) && !RESERVED_OUTPUTS.has(value);
}

function validateAgentStep(value: unknown, at: string, errors: string[]): WorkflowAgentStep | undefined {
  if (!isRecord(value)) {
    errors.push(`${at} must be an object.`);
    return undefined;
  }
  const agent = asText(value.agent);
  const task = asText(value.task);
  if (!agent) errors.push(`${at}.agent must be a non-empty agent name.`);
  if (!task) errors.push(`${at}.task must be a non-empty instruction.`);
  for (const [key, candidate] of Object.entries({ label: value.label, as: value.as, model: value.model, thinking: value.thinking })) {
    if (candidate !== undefined && !asText(candidate)) errors.push(`${at}.${key} must be a non-empty string.`);
  }
  if (value.as !== undefined && !isOutputName(String(value.as))) {
    errors.push(`${at}.as must be an identifier used by later phases.`);
  }
  return agent && task
    ? {
        agent,
        task,
        label: asText(value.label),
        as: asText(value.as),
        model: asText(value.model),
        thinking: asText(value.thinking),
      }
    : undefined;
}

function validateConcurrency(value: unknown, at: string, errors: string[]): number | undefined {
  if (value === undefined) return undefined;
  const concurrency = asPositiveInt(value);
  if (!concurrency || concurrency > MAX_CONCURRENCY) {
    errors.push(`${at}.concurrency must be an integer from 1 to ${MAX_CONCURRENCY}.`);
    return undefined;
  }
  return concurrency;
}

/**
 * Validate and normalize untrusted model-produced workflow data. Returns a
 * static maximum agent count; a proposed workflow cannot silently exceed it.
 */
export function validateWorkflowSpec(input: unknown): WorkflowValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { valid: false, errors: ['Workflow must be an object.'] };

  const name = asText(input.name);
  const description = asText(input.description);
  const task = asText(input.task);
  if (!name || !NAME.test(name)) errors.push('name must be kebab-case, start with a letter, and be at most 63 characters.');
  if (!description) errors.push('description must be a non-empty summary.');
  if (!task) errors.push('task must be the original task or a self-contained task statement.');
  if (input.agentScope !== undefined && !['user', 'project', 'both'].includes(String(input.agentScope))) {
    errors.push('agentScope must be user, project, or both.');
  }
  if (!Array.isArray(input.chain) || input.chain.length === 0) {
    errors.push('chain must contain at least one phase.');
    return { valid: false, errors };
  }
  if (input.chain.length > MAX_PHASES) errors.push(`chain may contain at most ${MAX_PHASES} phases.`);

  const outputs = new Set<string>();
  let maximumAgentCount = 0;
  const chain: WorkflowStep[] = [];

  for (const [index, rawStep] of input.chain.entries()) {
    const at = `chain[${index}]`;
    if (!isRecord(rawStep)) {
      errors.push(`${at} must be an object.`);
      continue;
    }
    if ('agent' in rawStep) {
      const step = validateAgentStep(rawStep, at, errors);
      if (!step) continue;
      if (step.as) {
        if (outputs.has(step.as)) errors.push(`${at}.as duplicates output "${step.as}".`);
        outputs.add(step.as);
      }
      chain.push(step);
      maximumAgentCount += 1;
      continue;
    }
    if ('expand' in rawStep) {
      const expand = rawStep.expand;
      const parallel = validateAgentStep(rawStep.parallel, `${at}.parallel`, errors);
      const collect = rawStep.collect;
      if (!isRecord(expand)) {
        errors.push(`${at}.expand must be an object.`);
        continue;
      }
      const from = asText(expand.from);
      const path = asText(expand.path);
      const item = asText(expand.item);
      const maxItems = asPositiveInt(expand.maxItems);
      if (!from || !outputs.has(from)) errors.push(`${at}.expand.from must reference an earlier named output.`);
      if (!path?.startsWith('/')) errors.push(`${at}.expand.path must be a JSON pointer beginning with '/'.`);
      if (!item || !isOutputName(item)) errors.push(`${at}.expand.item must be an identifier.`);
      if (!maxItems) errors.push(`${at}.expand.maxItems must be a positive integer.`);
      if (!isRecord(collect) || !asText(collect.as) || !isOutputName(String(collect.as))) {
        errors.push(`${at}.collect.as must be an identifier.`);
      } else if (outputs.has(String(collect.as))) {
        errors.push(`${at}.collect.as duplicates output "${collect.as}".`);
      }
      const concurrency = validateConcurrency(rawStep.concurrency, at, errors);
      if (!parallel || !from || !path || !item || !maxItems || !isRecord(collect) || !asText(collect.as)) continue;
      outputs.add(String(collect.as));
      chain.push({
        expand: { from, path, item, maxItems },
        parallel,
        collect: { as: String(collect.as) },
        label: asText(rawStep.label),
        concurrency,
      });
      maximumAgentCount += maxItems;
      continue;
    }
    if (Array.isArray(rawStep.parallel)) {
      const tasks = rawStep.parallel
        .map((candidate, childIndex) => validateAgentStep(candidate, `${at}.parallel[${childIndex}]`, errors))
        .filter((candidate): candidate is WorkflowAgentStep => Boolean(candidate));
      if (tasks.length === 0) {
        errors.push(`${at}.parallel must contain at least one valid agent step.`);
        continue;
      }
      for (const task of tasks) {
        if (task.as) {
          if (outputs.has(task.as)) errors.push(`${at}.parallel output "${task.as}" is duplicated.`);
          outputs.add(task.as);
        }
      }
      chain.push({ parallel: tasks, label: asText(rawStep.label), concurrency: validateConcurrency(rawStep.concurrency, at, errors) });
      maximumAgentCount += tasks.length;
      continue;
    }
    errors.push(`${at} must be an agent, parallel, or bounded fan-out phase.`);
  }

  if (maximumAgentCount > MAX_AGENTS) {
    errors.push(`Workflow can spawn at most ${MAX_AGENTS} agents; this one can spawn ${maximumAgentCount}.`);
  }
  if (errors.length > 0 || !name || !description || !task) return { valid: false, errors };

  const normalized: WorkflowSpec = {
    name,
    description,
    task,
    agentScope: input.agentScope as WorkflowSpec['agentScope'],
    chain,
  };
  return {
    valid: true,
    errors: [],
    normalized,
    maximumAgentCount,
    phases: chain.map((step, index) => phaseLabel(step, index)),
  };
}

export function phaseLabel(step: WorkflowStep, index: number): string {
  if ('agent' in step) return step.label ?? step.agent;
  return step.label ?? `Phase ${index + 1}`;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Compact plain-text phase table for the approval dialog. The select prompt
 * cannot scroll, so the full JSON is never dumped there — it lives in the
 * draft file and in the Edit JSON editor. One row per agent; parallel
 * children share their phase number.
 */
export function workflowTable(spec: WorkflowSpec): string {
  const header = ['#', 'Phase', 'Agent', 'Model', 'Output', 'Task'];
  const outputRef = (name?: string) => (name ? `{outputs.${name}}` : '—');
  const rows: string[][] = [];
  spec.chain.forEach((step, index) => {
    const phase = truncate(phaseLabel(step, index), 24);
    if ('agent' in step) {
      rows.push([String(index + 1), phase, step.agent, step.model ?? '—', outputRef(step.as), truncate(step.task, 48)]);
      return;
    }
    if ('expand' in step) {
      rows.push([
        String(index + 1),
        phase,
        `${step.parallel.agent} ×≤${step.expand.maxItems}`,
        step.parallel.model ?? '—',
        outputRef(step.collect.as),
        truncate(step.parallel.task, 48),
      ]);
      return;
    }
    step.parallel.forEach((child, childIndex) => {
      rows.push([
        childIndex === 0 ? String(index + 1) : '',
        childIndex === 0 ? phase : '',
        child.agent,
        child.model ?? '—',
        outputRef(child.as),
        truncate(child.task, 48),
      ]);
    });
  });
  const widths = header.map((cell, col) => Math.max(cell.length, ...rows.map((row) => row[col].length)));
  const line = (cells: string[]) => cells.map((cell, col) => cell.padEnd(widths[col])).join('  ').trimEnd();
  const divider = widths.map((width) => '─'.repeat(width)).join('──');
  return [line(header), divider, ...rows.map(line)].join('\n');
}

export function workflowSummary(spec: WorkflowSpec, maximumAgentCount: number): string {
  return [
    `Workflow: ${spec.name}`,
    spec.description,
    `Maximum agents: ${maximumAgentCount}`,
    ...spec.chain.map((step, index) => `${index + 1}. ${phaseLabel(step, index)}`),
  ].join('\n');
}
