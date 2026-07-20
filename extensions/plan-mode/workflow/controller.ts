import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { PlanModeState } from '../state.js';
import { SubagentWorkflowRpc, type WorkflowRunSnapshot } from './subagents-rpc.js';
import type { WorkflowSpec } from './spec.js';

const STATUS_KEY = 'workflow-run';
const POLL_INTERVAL_MS = 2_500;
const OUTPUT_SNIPPET_CHARS = 500;

/** Minimal UI surface the watcher needs; matches ExtensionContext['ui']. */
export interface WorkflowStatusUi {
  setStatus(key: string, text: string | undefined): void;
  notify(message: string, level?: 'info' | 'warning' | 'error'): void;
}

/**
 * Keeps workflow run ownership and session persistence behind one small seam,
 * and renders ambient progress for the background run: a status-bar indicator
 * (`⚙ wf 3/9 <phase>`) polled from the engine, plus a terminal-state message
 * into the conversation so completion never requires manual /workflow status.
 */
export class WorkflowModeController {
  private ui: WorkflowStatusUi | undefined;
  private watcher: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  /** Only watcher-observed transitions announce; restoring an old finished run stays quiet. */
  private announceEligible = false;

  constructor(
    private readonly state: PlanModeState,
    private readonly pi: ExtensionAPI,
    private readonly rpc: SubagentWorkflowRpc = SubagentWorkflowRpc.fromPi(pi),
  ) {}

  async verifyEngine(): Promise<void> {
    await this.rpc.ping();
  }

  /** Bind the session UI. Restarts the watcher when a run is already attached (session restore in the same process). */
  attachUI(ui: WorkflowStatusUi): void {
    this.ui = ui;
    if (this.runId) this.startWatcher();
  }

  async launch(workflow: WorkflowSpec): Promise<string> {
    await this.verifyEngine();
    const result = await this.rpc.spawn(workflow);
    this.state.workflow = { draft: workflow, runId: result.id };
    this.state.persist(this.pi);
    this.announceEligible = true;
    this.startWatcher();
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
    this.announceEligible = true;
    this.startWatcher();
    return result.id;
  }

  get draft(): WorkflowSpec | undefined {
    return this.state.workflow.draft as WorkflowSpec | undefined;
  }

  get runId(): string | undefined {
    return this.state.workflow.runId;
  }

  private startWatcher(): void {
    if (!this.ui || !this.runId) return;
    this.stopWatcher();
    const timer = setInterval(() => void this.pollOnce(), POLL_INTERVAL_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.watcher = timer;
    void this.pollOnce();
  }

  private stopWatcher(): void {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = undefined;
  }

  /** One status poll: update the footer indicator; announce and stop on a terminal state. Exposed for tests. */
  async pollOnce(): Promise<void> {
    if (this.polling || !this.ui || !this.runId) return;
    this.polling = true;
    try {
      const snapshot = await this.rpc.status(this.runId);
      if (Array.isArray(snapshot) || !snapshot) {
        // The engine does not know this run (fresh pi process) — go quiet.
        this.stopWatcher();
        this.ui.setStatus(STATUS_KEY, undefined);
        return;
      }
      const total = snapshot.phases.length;
      const done = snapshot.phases.filter((phase) => phase.status === 'completed').length;
      if (snapshot.status === 'running') {
        const running = snapshot.phases.find((phase) => phase.status === 'running')?.label;
        this.ui.setStatus(STATUS_KEY, `⚙ wf ${done}/${total}${running ? ` ${running}` : ''}`);
        return;
      }
      this.stopWatcher();
      const icon = snapshot.status === 'completed' ? '✓' : snapshot.status === 'stopped' ? '◼' : '✗';
      this.ui.setStatus(STATUS_KEY, `${icon} wf ${snapshot.status} ${done}/${total}`);
      if (this.announceEligible) {
        this.announceEligible = false;
        this.announceTerminal(snapshot, done, total);
      }
    } catch {
      // Engine unavailable mid-run (extension unloaded, process shutdown) — stop polling quietly.
      this.stopWatcher();
      this.ui?.setStatus(STATUS_KEY, undefined);
    } finally {
      this.polling = false;
    }
  }

  private announceTerminal(snapshot: WorkflowRunSnapshot, done: number, total: number): void {
    const level = snapshot.status === 'completed' ? 'info' : snapshot.status === 'stopped' ? 'warning' : 'error';
    this.ui?.notify(`Background workflow ${snapshot.status}: ${snapshot.id} (${done}/${total} phases)`, level);

    const lines = [
      `**Background workflow ${snapshot.status}** — \`${snapshot.id}\` (${done}/${total} phases)`,
      '',
      ...snapshot.phases.map((phase, index) => {
        const mark =
          phase.status === 'completed' ? '✓' : phase.status === 'failed' ? '✗' : phase.status === 'running' ? '…' : '·';
        return `${index + 1}. ${mark} ${phase.label}`;
      }),
    ];
    if (snapshot.error) lines.push('', `Error: ${snapshot.error}`);
    const finalOutput = snapshot.phases.at(-1)?.output;
    if (snapshot.status === 'completed' && finalOutput) {
      const snippet =
        finalOutput.length > OUTPUT_SNIPPET_CHARS ? `${finalOutput.slice(0, OUTPUT_SNIPPET_CHARS)}…` : finalOutput;
      lines.push('', '## Final output', '', snippet);
    }
    lines.push('', 'Inspect with `/workflow status`; `/workflow resume` relaunches a stopped or failed run.');
    this.pi.sendMessage(
      { customType: 'workflow-terminal', content: lines.join('\n'), display: true },
      { triggerTurn: false },
    );
  }
}
