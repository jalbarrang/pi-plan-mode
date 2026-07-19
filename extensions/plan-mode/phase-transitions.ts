/**
 * Phase transitions — enter/exit plan mode, start execution, switch models.
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { PlanModeState } from './state.js';
import {
  PLAN_TOOLS,
  EXEC_TOOLS,
  WORKFLOW_TOOLS,
} from './constants.js';
import { updateUI } from './ui.js';

export async function switchModel(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  preset: { provider: string; id: string },
): Promise<boolean> {
  const model = ctx.modelRegistry.find(preset.provider, preset.id);
  if (!model) {
    ctx.ui.notify(`Model ${preset.provider}/${preset.id} not found`, 'error');
    return false;
  }
  const ok = await pi.setModel(model);
  if (!ok) {
    ctx.ui.notify(`No API key for ${preset.provider}/${preset.id}`, 'error');
    return false;
  }
  return true;
}

/**
 * Snapshot the idle active toolset before a mode narrows it. Only captures
 * when leaving idle — plan→execute and workflow→plan transitions keep the
 * original snapshot so the eventual exit restores the true pre-mode set.
 */
export function captureIdleTools(state: PlanModeState, pi: ExtensionAPI): void {
  if (state.phase === 'idle') state.preModeActiveTools = pi.getActiveTools();
}

/**
 * Restore the toolset captured by `captureIdleTools`. Falls back to every
 * registered tool for sessions persisted before the snapshot existed — closer
 * to pi's default (all tools active) than any hardcoded subset.
 */
export function restoreIdleTools(state: PlanModeState, pi: ExtensionAPI): void {
  const tools = state.preModeActiveTools ?? pi.getAllTools().map((tool) => tool.name);
  state.preModeActiveTools = undefined;
  pi.setActiveTools(tools);
}

export async function enterPlanMode(
  state: PlanModeState,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  captureIdleTools(state, pi);
  state.planEnabled = true;
  state.executing = false;
  state.planDir = undefined;
  state.plan = undefined;
  state.previousModel = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;
  pi.setActiveTools(PLAN_TOOLS);
  ctx.ui.notify('Plan mode ON', 'info');
  updateUI(state, ctx);
  state.persist(pi);
}

/** Enter read-only workflow design without discarding the attached plan. */
export function enterWorkflowMode(
  state: PlanModeState,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): void {
  captureIdleTools(state, pi);
  state.phase = 'workflow';
  state.executionStartIdx = undefined;
  pi.setActiveTools(WORKFLOW_TOOLS);
  ctx.ui.notify('Workflow mode ON', 'info');
  updateUI(state, ctx);
  state.persist(pi);
}

export async function exitWorkflowMode(
  state: PlanModeState,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  state.exitPreservingPlan();
  restoreIdleTools(state, pi);
  ctx.ui.notify('Workflow mode OFF', 'info');
  updateUI(state, ctx);
  state.persist(pi);
}

export async function exitPlanMode(
  state: PlanModeState,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const { previousModel } = state;
  state.exitPreservingPlan();
  restoreIdleTools(state, pi);
  if (previousModel) {
    await switchModel(pi, ctx, previousModel);
  }
  ctx.ui.notify('Plan mode OFF', 'info');
  updateUI(state, ctx);
  state.persist(pi);
}

export async function startExecution(
  state: PlanModeState,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  captureIdleTools(state, pi);
  state.planEnabled = false;
  state.executing = true;
  state.executionStartIdx = ctx.sessionManager.getEntries().length;
  pi.setActiveTools(EXEC_TOOLS);
  ctx.ui.notify('Executing plan', 'info');
  updateUI(state, ctx);
  state.persist(pi);
}
