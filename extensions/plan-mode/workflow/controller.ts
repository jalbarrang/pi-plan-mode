import { resolve } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { WORKFLOW_RUNS_ROOT } from '../ledger.js';
import type { PlanModeState } from '../state.js';
import { SubagentWorkflowRpc, type WorkflowRunSnapshot } from './subagents-rpc.js';
import type { WorkflowSpec } from './spec.js';

const STATUS_KEY = 'workflow-run';
const POLL_INTERVAL_MS = 2_500;
const SPINNER_INTERVAL_MS = 200;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const OUTPUT_SNIPPET_CHARS = 500;

/** Minimal UI surface the watcher needs; structurally compatible with ExtensionContext['ui']. */
export interface WorkflowStatusUi {
  setStatus(key: string, text: string | undefined): void;
  setWidget(
    key: string,
    lines: string[] | undefined,
    options?: { placement?: 'aboveEditor' | 'belowEditor' },
  ): void;
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
  private spinner: ReturnType<typeof setInterval> | undefined;
  private spinnerFrame = 0;
  private latestSnapshot: WorkflowRunSnapshot | undefined;
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
    const result = await this.rpc.spawn(workflow, { runsDir: resolve(WORKFLOW_RUNS_ROOT) });
    this.state.workflow = { draft: workflow, runId: result.id, launchedAt: new Date().toISOString() };
    this.state.persist(this.pi);
    this.announceEligible = true;
    this.latestSnapshot = undefined;
    this.renderStartingWidget();
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
    this.latestSnapshot = undefined;
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
    this.renderLatestWidget();
    const timer = setInterval(() => void this.pollOnce(), POLL_INTERVAL_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.watcher = timer;
    const spinner = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.renderLatestWidget();
    }, SPINNER_INTERVAL_MS);
    (spinner as unknown as { unref?: () => void }).unref?.();
    this.spinner = spinner;
    void this.pollOnce();
  }

  private stopWatcher(): void {
    if (this.watcher) clearInterval(this.watcher);
    if (this.spinner) clearInterval(this.spinner);
    this.watcher = undefined;
    this.spinner = undefined;
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
        this.ui.setWidget(STATUS_KEY, undefined);
        return;
      }
      this.latestSnapshot = snapshot;
      const total = snapshot.phases.length;
      const done = snapshot.phases.filter((phase) => phase.status === 'completed').length;
      if (snapshot.status === 'running') {
        const running = snapshot.phases.find((phase) => phase.status === 'running')?.label;
        this.ui.setStatus(STATUS_KEY, `⚙ wf ${done}/${total}${running ? ` ${running}` : ''}`);
        this.renderSnapshotWidget(snapshot);
        return;
      }
      this.stopWatcher();
      this.ui.setWidget(STATUS_KEY, undefined);
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
      this.ui?.setWidget(STATUS_KEY, undefined);
    } finally {
      this.polling = false;
    }
  }

  private renderLatestWidget(): void {
    if (this.latestSnapshot) {
      this.renderSnapshotWidget(this.latestSnapshot);
    } else {
      this.renderStartingWidget();
    }
  }

  private renderStartingWidget(): void {
    this.ui?.setWidget(STATUS_KEY, [`⚙ workflow ${this.workflowName} — starting…`, '/workflow status · /workflow stop'], {
      placement: 'belowEditor',
    });
  }

  private renderSnapshotWidget(snapshot: WorkflowRunSnapshot): void {
    const completed = snapshot.phases.filter((phase) => phase.status === 'completed').length;
    const running = snapshot.phases.some((phase) => phase.status === 'running') ? 1 : 0;
    const lines = [
      `${SPINNER_FRAMES[this.spinnerFrame]} workflow ${this.workflowName} — phase ${completed + running}/${snapshot.phases.length} · ${this.formatElapsed(snapshot.startedAt ?? this.state.workflow.launchedAt)}`,
      ...snapshot.phases.map((phase) => {
        const mark = phase.status === 'completed' ? '✓' : phase.status === 'failed' ? '✗' : phase.status === 'running' ? '…' : '·';
        const agents = phase.status === 'running' && phase.agents ? ` ×${phase.agents.done}/${phase.agents.total}` : '';
        return `${mark} ${phase.label}${agents}`;
      }),
      '/workflow status · /workflow stop',
    ];
    this.ui?.setWidget(STATUS_KEY, lines, { placement: 'belowEditor' });
  }

  private get workflowName(): string {
    return this.draft?.name ?? this.runId ?? 'workflow';
  }

  private formatElapsed(startedAt: string | undefined): string {
    const started = startedAt ? Date.parse(startedAt) : Number.NaN;
    const elapsedSeconds = Number.isNaN(started) ? 0 : Math.max(0, Math.floor((Date.now() - started) / 1_000));
    const hours = Math.floor(elapsedSeconds / 3_600);
    const minutes = Math.floor((elapsedSeconds % 3_600) / 60);
    const seconds = elapsedSeconds % 60;
    return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
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
