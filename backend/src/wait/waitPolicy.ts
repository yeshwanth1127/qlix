import type { TeamConfig } from '../teams/teams.types.js';
import type { WaitPolicySnapshot, WaitSideEffect, WaitStep } from './waitPolicy.types.js';
export const WHATSAPP_REPLY_LIVE_SHEET_EFFECT: WaitSideEffect = {
  id: 'live_reply_sheet',
  kind: 'live_sandbox_artifact',
  title: 'WhatsApp responders',
  dedupeBy: 'contact_jid',
  filter: { classifier: 'reply_interest', include: ['interested', 'unclear'] },
  contactAck: 'fixed',
  deliver: { channel: 'whatsapp', when: 'on_resume' },
};

const REPLY_WAIT_NOUN = String.raw`(?:reply|replies|respond|response|responses|poll\s+votes?)`;

export function goalRequestsReplyWait(goal: string): boolean {
  return (
    new RegExp(String.raw`\bwait\s+(?:for|until)\b[\s\S]{0,120}\b${REPLY_WAIT_NOUN}\b`, 'i').test(goal) ||
    new RegExp(String.raw`\b(?:if|when|once|after)\b[\s\S]{0,120}\b${REPLY_WAIT_NOUN}\b`, 'i').test(goal) ||
    /\bcollect\b[\s\S]{0,80}\b(?:reply|replies|respond|response|responses|poll)\b/i.test(goal) ||
    /\bvia the poll\b/i.test(goal) ||
    (/\bpoll\b/i.test(goal) && /\b(wait|listen|collect|capture)\b/i.test(goal))
  );
}

export function goalRequestsBrochureFile(goal: string): boolean {
  return /\bbrochure\b/i.test(goal);
}

export function goalRequestsInterestPoll(goal: string): boolean {
  return /\bpoll\b/i.test(goal);
}

export function goalRequestsOutreachPack(goal: string): boolean {
  return goalRequestsBrochureFile(goal) || goalRequestsInterestPoll(goal) || goalRequestsReplyWait(goal);
}

export type TeamWhatsAppWaitMode = 'queue' | 'live' | 'blocked';

const ACTIVE_TEAM_RUN = new Set(['queued', 'running', 'paused']);

export function resolveTeamWhatsAppWaitMode(input: {
  teamRunStatus: string;
  goal: string;
  waitSteps?: unknown;
}): TeamWhatsAppWaitMode {
  if (!ACTIVE_TEAM_RUN.has(input.teamRunStatus)) return 'blocked';
  const waitsConfigured =
    goalRequestsReplyWait(input.goal) ||
    (Array.isArray(input.waitSteps) && input.waitSteps.length > 0);
  return waitsConfigured ? 'queue' : 'live';
}

export function goalRequestsLiveArtifact(goal: string): boolean {
  return /\b(sheet|spreadsheet|excel|xlsx|workbook|pdf|ppt|pptx|powerpoint|slides?|deck|document|docx|word|csv|json|markdown|\bmd\b|html|report|file)\b/i.test(
    goal,
  );
}

export function buildWhatsAppReplyWaitStep(afterStageOrder: number): WaitStep {
  return {
    id: 'whatsapp_reply_wait',
    afterStageOrder,
    trigger: { kind: 'whatsapp_inbound', fulfillment: 'collect_until_timeout' },
    sideEffects: [{ ...WHATSAPP_REPLY_LIVE_SHEET_EFFECT }],
    resume: { injectAs: 'whatsapp_responses' },
  };
}

export function inferWaitStepsFromGoal(goal: string, afterStageOrder: number): WaitStep[] {
  if (!goalRequestsReplyWait(goal)) return [];

  const sideEffects: WaitSideEffect[] = [];
  if (goalRequestsLiveArtifact(goal)) {
    sideEffects.push({ ...WHATSAPP_REPLY_LIVE_SHEET_EFFECT });
  }
  if (sideEffects.length === 0) return [];

  return [buildWhatsAppReplyWaitStep(afterStageOrder)];
}

export function resolveWaitStepsForTeam(
  teamConfig: TeamConfig,
  goal: string,
  outreachStageOrder: number,
): WaitStep[] {
  if (Array.isArray(teamConfig.waitSteps) && teamConfig.waitSteps.length > 0) {
    return teamConfig.waitSteps;
  }
  return inferWaitStepsFromGoal(goal, outreachStageOrder);
}

export function findWaitStepForStage(
  waitSteps: WaitStep[],
  afterStageOrder: number,
): WaitStep | null {
  return waitSteps.find((step) => step.afterStageOrder === afterStageOrder) ?? null;
}

export function buildWaitPolicySnapshot(
  waitSteps: WaitStep[],
  activeWaitStepId: string,
): WaitPolicySnapshot {
  return { waitSteps, activeWaitStepId };
}

export function getActiveWaitStep(snapshot: WaitPolicySnapshot | null | undefined): WaitStep | null {
  if (!snapshot?.waitSteps?.length) return null;
  return (
    snapshot.waitSteps.find((step) => step.id === snapshot.activeWaitStepId) ??
    snapshot.waitSteps[0] ??
    null
  );
}

export function liveArtifactSideEffects(step: WaitStep | null): WaitSideEffect[] {
  if (!step) return [];
  return step.sideEffects.filter((effect) => effect.kind === 'live_sandbox_artifact');
}

export function resolveContactAck(step: WaitStep | null): 'fixed' | 'none' | 'auto_reply' {
  const ackEffects = step?.sideEffects
    .map((effect) => effect.contactAck)
    .filter(Boolean) as Array<'fixed' | 'none' | 'auto_reply'>;
  if (ackEffects.includes('auto_reply')) return 'auto_reply';
  if (ackEffects.every((ack) => ack === 'none')) return 'none';
  return 'fixed';
}

export function completedStageOrderFromPlan(
  plan: Array<{ stageOrder: number }>,
  nextStageIndex: number,
): number {
  const stageOrders = [...new Set(plan.map((subtask) => subtask.stageOrder))].sort((a, b) => a - b);
  if (nextStageIndex <= 0) return stageOrders[0] ?? 1;
  return stageOrders[nextStageIndex - 1] ?? nextStageIndex;
}

export function inferOutreachStageOrderFromWorkers(
  workers: Array<{ stageOrder: number; permissionScopes: string[] }>,
): number {
  const outreach = workers.find((worker) =>
    worker.permissionScopes.includes('whatsapp.contact_send'),
  );
  if (outreach) return outreach.stageOrder;
  return Math.max(...workers.map((worker) => worker.stageOrder), 1);
}

export function inferTeamWaitStepsFromSpec(input: {
  name: string;
  description: string;
  workers: Array<{ stageOrder: number; permissionScopes: string[]; description: string }>;
}): WaitStep[] {
  const goal = [input.name, input.description, ...input.workers.map((worker) => worker.description)].join('\n');
  const stageOrder = inferOutreachStageOrderFromWorkers(input.workers);
  return inferWaitStepsFromGoal(goal, stageOrder);
}

export function ensureCheckpointWaitPolicy(
  checkpoint: import('../teams/teams.types.js').TeamRunCheckpoint,
  teamConfig: TeamConfig,
  runGoal: string,
): import('../teams/teams.types.js').TeamRunCheckpoint {
  if (checkpoint.waitPolicySnapshot) return checkpoint;
  const outreachStageOrder = completedStageOrderFromPlan(checkpoint.plan ?? [], checkpoint.nextStageIndex);
  const waitSteps = resolveWaitStepsForTeam(teamConfig, runGoal, outreachStageOrder);
  const waitStep = findWaitStepForStage(waitSteps, outreachStageOrder);
  if (!waitStep) return checkpoint;
  return {
    ...checkpoint,
    waitPolicySnapshot: buildWaitPolicySnapshot(waitSteps, waitStep.id),
  };
}
