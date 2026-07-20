/**
 * Thin client for the optional `@dreki-gg/pi-subagent` workflow bridge.
 *
 * Keeping this on the event seam means plan-mode does not import the optional
 * companion package or duplicate agent discovery/execution in its own bundle.
 */

import { randomUUID } from 'node:crypto';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { WorkflowSpec } from './spec.js';

const REQUEST_EVENT = 'subagents:rpc:v1:request';
const REPLY_EVENT_PREFIX = 'subagents:rpc:v1:reply:';
const DEFAULT_TIMEOUT_MS = 2_000;

export interface RpcBus {
  on(topic: string, listener: (payload: unknown) => void): (() => void) | void;
  emit(topic: string, payload: unknown): void;
}

export interface WorkflowRunSnapshot {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  startedAt?: string;
  finishedAt?: string;
  phases: Array<{
    label: string;
    status: string;
    output?: string;
    startedAt?: string;
    finishedAt?: string;
    agents?: { done: number; total: number };
  }>;
  error?: string;
}

export class SubagentWorkflowUnavailableError extends Error {
  constructor() {
    super(
      'Workflow mode requires @dreki-gg/pi-subagent with workflow RPC support. Install or update it, then restart Pi: pi install npm:@dreki-gg/pi-subagent',
    );
    this.name = 'SubagentWorkflowUnavailableError';
  }
}

function getBus(pi: ExtensionAPI): RpcBus | undefined {
  const candidate = (pi as unknown as { events?: RpcBus }).events;
  return candidate && typeof candidate.on === 'function' && typeof candidate.emit === 'function'
    ? candidate
    : undefined;
}

export class SubagentWorkflowRpc {
  constructor(
    private readonly bus: RpcBus | undefined,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  static fromPi(pi: ExtensionAPI): SubagentWorkflowRpc {
    return new SubagentWorkflowRpc(getBus(pi));
  }

  async ping(): Promise<void> {
    await this.request('ping');
  }

  async spawn(workflow: WorkflowSpec): Promise<{ id: string }> {
    const data = await this.request('spawn', { workflow });
    if (!data || typeof data !== 'object' || typeof (data as { id?: unknown }).id !== 'string') {
      throw new Error('pi-subagent returned an invalid workflow launch response.');
    }
    return { id: (data as { id: string }).id };
  }

  async status(id?: string): Promise<WorkflowRunSnapshot | WorkflowRunSnapshot[]> {
    return (await this.request('status', id ? { id } : undefined)) as
      | WorkflowRunSnapshot
      | WorkflowRunSnapshot[];
  }

  async stop(id: string): Promise<void> {
    await this.request('stop', { id });
  }

  async resume(id: string): Promise<{ id: string }> {
    const data = await this.request('resume', { id });
    if (!data || typeof data !== 'object' || typeof (data as { id?: unknown }).id !== 'string') {
      throw new Error('pi-subagent returned an invalid workflow resume response.');
    }
    return { id: (data as { id: string }).id };
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    if (!this.bus) return Promise.reject(new SubagentWorkflowUnavailableError());
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      let settled = false;
      let dispose: (() => void) | void;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      dispose = this.bus!.on(`${REPLY_EVENT_PREFIX}${requestId}`, (raw) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        if (typeof dispose === 'function') dispose();
        const response = raw as { success?: unknown; data?: unknown; error?: { message?: unknown } };
        if (response.success === true) {
          resolve(response.data);
        } else {
          reject(new Error(typeof response.error?.message === 'string' ? response.error.message : 'Workflow RPC failed.'));
        }
      });
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (typeof dispose === 'function') dispose();
        reject(new SubagentWorkflowUnavailableError());
      }, this.timeoutMs);
      this.bus!.emit(REQUEST_EVENT, { version: 1, requestId, method, params });
    });
  }
}
