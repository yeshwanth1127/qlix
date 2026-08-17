import type {
  TeamConfig,
  TeamDTO,
  TeamRunDTO,
  TeamRunReplyChannel,
  TeamRunInput,
  TeamRunSourceChannel,
} from './teams.types.js';
import { TeamOrchestrator } from './teamOrchestrator.js';
import { TeamsRepository } from './teams.repository.js';
import { TeamContinuesRunError, TeamsService } from './teams.service.js';
import {
  applyTeamRunFollowUp,
  firstInputsInContinueChain,
  firstRealGoalInContinueChain,
  priorContextFromRun,
} from './teamRunFollowUp.js';
import {
  createResolvedTeamIntent,
  resolvedIntentForRun,
  resolveTeamFollowUpIntent,
  TeamIntentClarificationRequiredError,
} from './teamIntent.js';
import type { ResolvedTeamIntent } from './teams.types.js';

const FINISHED_RUN_STATUSES = new Set(['completed', 'failed', 'canceled']);

const orchestrator = new TeamOrchestrator();
const teamsService = new TeamsService();
const teamsRepo = new TeamsRepository();
const resumeInFlight = new Set<string>();

export interface LaunchTeamRunInput {
  teamId: string;
  orgId: string;
  userId: string;
  goal: string;
  backendUrl?: string;
  /** Overrides team.config.defaultModel for this execution only. */
  inferenceModel?: string;
  reasoningEffort?: string | null;
  source?: {
    channel: TeamRunSourceChannel;
    connectorId?: string;
  };
  replyChannel?: TeamRunReplyChannel;
  /** Prior TeamRun this send continues; WhatsApp infers the latest finished run when omitted. */
  continuesRunId?: string | null;
  inputs?: TeamRunInput[];
}

async function resolveContinuedGoal(input: LaunchTeamRunInput): Promise<{
  goal: string;
  resolvedIntent: ResolvedTeamIntent;
  continuesRunId: string | null;
  priorInputs: TeamRunInput[];
}> {
  let continuesRunId = input.continuesRunId?.trim() || null;
  if (!continuesRunId && input.source?.channel === 'whatsapp') {
    const latest = await teamsRepo.findLatestFinishedRun(input.teamId, input.userId);
    continuesRunId = latest?.id ?? null;
  }
  if (!continuesRunId) {
    return {
      goal: input.goal,
      resolvedIntent: createResolvedTeamIntent({ userMessage: input.goal }),
      continuesRunId: null,
      priorInputs: [],
    };
  }

  const priorRun = await teamsRepo.findRun(continuesRunId);
  if (!priorRun || priorRun.teamId !== input.teamId) {
    throw new TeamContinuesRunError();
  }
  if (!FINISHED_RUN_STATUSES.has(priorRun.status)) {
    throw new TeamContinuesRunError('Cannot continue a run that is still active');
  }

  const events = await teamsRepo.listEvents(continuesRunId);
  const chain = await loadContinueChain(continuesRunId, priorRun.teamId);
  const originalGoal = firstRealGoalInContinueChain(chain);
  const prior = priorContextFromRun(priorRun, events);
  const baseIntent = resolvedIntentForRun({
    ...priorRun,
    goal: originalGoal || priorRun.goal,
  });
  let resolvedIntent: ResolvedTeamIntent;
  try {
    resolvedIntent = await resolveTeamFollowUpIntent({
      userMessage: input.goal,
      baseRunId: priorRun.id,
      baseIntent,
      previousResult: prior.synthesis ?? prior.errorMessage,
      pendingClarification: latestClarificationQuestion(events),
    });
  } catch (err) {
    if (err instanceof TeamIntentClarificationRequiredError) {
      // No run exists to carry this question, so record it on the run being continued.
      // Without it the user's message and our reply both vanish from the chat.
      await recordClarification(priorRun.id, priorRun.teamId, input.goal.trim(), err);
    }
    throw err;
  }
  return {
    goal: applyTeamRunFollowUp(input.goal, {
      ...prior,
      goal: originalGoal || prior.goal,
    }),
    resolvedIntent,
    continuesRunId,
    priorInputs: firstInputsInContinueChain(chain),
  };
}

/** The question we last asked and the message that triggered it, kept in the run timeline. */
async function recordClarification(
  runId: string,
  teamId: string,
  userMessage: string,
  err: TeamIntentClarificationRequiredError,
): Promise<void> {
  err.runId = runId;
  try {
    const event = await teamsRepo.appendEvent(runId, teamId, null, 'clarification_requested', {
      question: err.message,
      userMessage,
    });
    err.eventId = event.id;
  } catch (appendErr) {
    console.error(`[team-run] could not record clarification for run ${runId}:`, appendErr);
  }
}

function latestClarificationQuestion(
  events: Array<{ eventType: string; payload: unknown }>,
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.eventType !== 'clarification_requested') continue;
    const question = (event.payload as { question?: unknown } | null)?.question;
    return typeof question === 'string' && question.trim() ? question.trim() : null;
  }
  return null;
}

async function loadContinueChain(
  startRunId: string,
  teamId: string,
): Promise<Array<{ goal: string; inputs: TeamRunInput[] }>> {
  const chain: Array<{ goal: string; inputs: TeamRunInput[] }> = [];
  let id: string | null = startRunId;
  const seen = new Set<string>();
  for (let hops = 0; hops < 20 && id && !seen.has(id); hops++) {
    seen.add(id);
    const run = await teamsRepo.findRun(id);
    if (!run || run.teamId !== teamId) break;
    chain.push({ goal: run.goal, inputs: run.inputs ?? [] });
    id = run.continuesRunId ?? null;
  }
  return chain;
}

export async function launchTeamRun(input: LaunchTeamRunInput): Promise<{
  run: TeamRunDTO;
  team: TeamDTO;
}> {
  const sourceChannel = input.source?.channel ?? 'web';
  const { goal, resolvedIntent, continuesRunId, priorInputs } = await resolveContinuedGoal(input);
  const inputs =
    input.inputs && input.inputs.length > 0 ? input.inputs : priorInputs;
  const run = await teamsService.startRun(
    input.teamId,
    input.orgId,
    input.userId,
    goal,
    {
      sourceChannel,
      sourceConnectorId: input.source?.connectorId ?? null,
      replyChannel: input.replyChannel,
      continuesRunId,
      inputs,
      resolvedIntent,
    },
    input.backendUrl,
  );

  const team = await teamsService.getTeam(input.teamId, input.orgId);
  const modelOverride = input.inferenceModel?.trim();
  const effortOverride = input.reasoningEffort?.trim() || null;
  const effectiveTeam: TeamDTO =
    modelOverride || effortOverride
      ? {
          ...team,
          config: {
            ...(team.config as TeamConfig),
            ...(modelOverride ? { defaultModel: modelOverride } : {}),
            ...(effortOverride ? { defaultReasoningEffort: effortOverride } : {}),
          },
        }
      : team;

  if (sourceChannel === 'whatsapp' && input.source?.connectorId) {
    await teamsRepo.upsertChannelSession({
      connectorId: input.source.connectorId,
      teamRunId: run.id,
      teamId: team.id,
      userId: input.userId,
    });
  }

  if (modelOverride) {
    console.info(`[team-run] run=${run.id} inferenceModel=${modelOverride}`);
  }

  orchestrator.execute(run, effectiveTeam, () => {}).catch((err) => {
    console.error(`[TeamOrchestrator] run ${run.id} failed:`, err);
  });

  return { run, team: effectiveTeam };
}

/** Resume a paused run after a durable external wait trigger is fulfilled. */
export async function resumeTeamRun(runId: string): Promise<void> {
  const run = await teamsRepo.findRun(runId);
  if (!run) throw new Error(`Team run ${runId} was not found`);
  if (run.status !== 'paused') return;
  if (resumeInFlight.has(runId)) return;
  resumeInFlight.add(runId);

  try {
    const team = await teamsService.getTeam(run.teamId, run.orgId);
    const checkpoint = run.checkpointJson as {
      inferenceModel?: string | null;
    } | null;
    // Prefer: (1) model saved at pause, (2) model used by an earlier successful
    // worker in this run, (3) team default. Do not let team default short-circuit
    // recovery — that caused post-pause stages to fall onto Exora after OpenRouter runs.
    let recoveredModel = checkpoint?.inferenceModel?.trim() || null;
    if (!recoveredModel) {
      recoveredModel = await teamsRepo.findLatestSuccessfulAgentInferenceModel(run.id);
    }
    if (!recoveredModel) {
      recoveredModel = (team.config as TeamConfig).defaultModel?.trim() || null;
    }

    const effectiveTeam: TeamDTO = recoveredModel
      ? {
          ...team,
          config: {
            ...(team.config as TeamConfig),
            defaultModel: recoveredModel,
          },
        }
      : team;

    if (recoveredModel) {
      console.info(`[team-run] resume=${run.id} inferenceModel=${recoveredModel}`);
    }

    await orchestrator.resume(run, effectiveTeam, () => {}).catch((err) => {
      console.error(`[TeamOrchestrator] resume ${run.id} failed:`, err);
    });
  } finally {
    resumeInFlight.delete(runId);
  }
}
