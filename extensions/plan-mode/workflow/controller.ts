import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { PlanModeState } from '../state.js';
import { SubagentWorkflowRpc, type WorkflowRunSnapshot } from './subagents-rpc.js';
import type { WorkflowSpec } from './spec.js';

/** Keeps workflow run ownership and session persistence behind one small seam. */
export class WorkflowModeController {
  constructor(
    private readonly state: PlanModeState,
    private readonly pi: ExtensionAPI,
    private readonly rpc: SubagentWorkflowRpc = SubagentWorkflowRpc.fromPi(pi),
  ) {}

  async verifyEngine(): Promise<void> {
    await this.rpc.ping();
  }

  async launch(workflow: WorkflowSpec): Promise<string> {
    await this.verifyEngine();
    const result = await this.rpc.spawn(workflow);
    this.state.workflow = { draft: workflow, runId: result.id };
    this.state.persist(this.pi);
    return result.id;
  }

  async status(): Promise<WorkflowRunSnapshot | WorkflowRunSnapshot[]> {
    return this.rpc.status(this.runId);
  }

  async stop(): Promise<void> {
    if (!this.runId) throw new Error('No workflow run is attached to this session.');
    await this.rpc.stop(this.runId);
  }

  async resume(): Promise<string> {
    if (!this.runId) throw new Error('No workflow run is attached to this session.');
    const result = await this.rpc.resume(this.runId);
    this.state.workflow.runId = result.id;
    this.state.persist(this.pi);
    return result.id;
  }

  get draft(): WorkflowSpec | undefined {
    return this.state.workflow.draft as WorkflowSpec | undefined;
  }

  get runId(): string | undefined {
    return this.state.workflow.runId;
  }
}
