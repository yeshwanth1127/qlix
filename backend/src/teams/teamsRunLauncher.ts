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
import {
  TeamContinuesRunError,
  TeamRunMissingAttachmentError,
  TeamsService,
} from './teams.service.js';
import {
  applyTeamRunFollowUp,
  firstInputsInContinueChain,
  firstRealGoalInContinueChain,
  goalImpliesAuthoritativeAttachment,
  isUnusableTeamSynthesis,
  lastResultFromEnvelope,
  pickUsableSynthesis,
  priorContextFromRun,
  synthesisFromTeamRunResult,
} from './teamRunFollowUp.js';
import {
  createResolvedTeamIntent,
  resolvedIntentForRun,
  resolveTeamFollowUpIntent,
} from './teamIntent.js';
import type { ResolvedTeamIntent } from './teams.types.js';

const FINISHED_RUN_STATUSES = new Set(['completed', 'failed', 'canceled']);

const orchestrator = new TeamOrchestrator();
const teamsService = new TeamsService();
const teamsRepo = new TeamsRepository();

export interface LaunchTeamRunInput {
  teamId: string;
  orgId: string;
  userId: string;
  goal: string;
  backendUrl?: string;
  /** Overrides team.config.defaultModel; persisted on the team when set. */
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

async function resolveContinuedGoal(
  input: LaunchTeamRunInput,
  inferenceModel: string | null,
): Promise<{
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

  // "Try again" after a failed PDF continue must not treat the blocked JSON as
  // the source document — walk the chain for the last usable Result (the draft).
  const recoveredSynthesis = await loadUsableSynthesisAlongContinueChain(
    continuesRunId,
    priorRun.teamId,
  );
  const priorForNote = {
    ...prior,
    goal: originalGoal || prior.goal,
    synthesis: recoveredSynthesis,
    errorMessage:
      recoveredSynthesis && !isUnusableTeamSynthesis(recoveredSynthesis)
        ? null
        : prior.errorMessage,
  };

  const baseIntent = resolvedIntentForRun({
    ...priorRun,
    goal: originalGoal || priorRun.goal,
  });

  let modelForIntent = inferenceModel;
  if (!modelForIntent) {
    modelForIntent = await teamsRepo.findLatestSuccessfulAgentInferenceModel(continuesRunId);
  }

  const resolvedIntent = await resolveTeamFollowUpIntent({
    userMessage: input.goal,
    baseRunId: priorRun.id,
    baseIntent,
    previousResult: priorForNote.synthesis ?? priorForNote.errorMessage,
    inferenceModel: modelForIntent,
  });
  return {
    goal: applyTeamRunFollowUp(input.goal, priorForNote),
    resolvedIntent,
    continuesRunId,
    priorInputs: firstInputsInContinueChain(chain),
  };
}

async function loadUsableSynthesisAlongContinueChain(
  startRunId: string,
  teamId: string,
): Promise<string | null> {
  let id: string | null = startRunId;
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (let hops = 0; hops < 20 && id && !seen.has(id); hops++) {
    seen.add(id);
    const run = await teamsRepo.findRun(id);
    if (!run || run.teamId !== teamId) break;
    const syn = synthesisFromTeamRunResult(run.result);
    if (syn) candidates.push(syn);
    const fromEnvelope = lastResultFromEnvelope(run.goal);
    if (fromEnvelope) candidates.push(fromEnvelope);
    id = run.continuesRunId ?? null;
  }
  return pickUsableSynthesis(candidates);
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

/** Persist picker choice on the team so reloads and follow-ups reuse it. */
async function persistTeamRunPreferences(
  team: TeamDTO,
  inferenceModel: string | null,
  reasoningEffort: string | null,
): Promise<TeamDTO> {
  const cfg = team.config as TeamConfig;
  const patch: Partial<TeamConfig> = {};
  if (inferenceModel && inferenceModel !== cfg.defaultModel?.trim()) {
    patch.defaultModel = inferenceModel;
  }
  if (reasoningEffort != null) {
    const next = reasoningEffort.trim() || undefined;
    const prev = cfg.defaultReasoningEffort?.trim() || undefined;
    if (next !== prev) {
      patch.defaultReasoningEffort = next;
    }
  }
  if (Object.keys(patch).length === 0) return team;
  return teamsRepo.updateConfig(team.id, patch);
}

export async function launchTeamRun(input: LaunchTeamRunInput): Promise<{
  run: TeamRunDTO;
  team: TeamDTO;
}> {
  const sourceChannel = input.source?.channel ?? 'web';
  let team = await teamsService.getTeam(input.teamId, input.orgId);
  const effortOverride = input.reasoningEffort?.trim() || null;

  let inferenceModel =
    input.inferenceModel?.trim() ||
    (team.config as TeamConfig).defaultModel?.trim() ||
    null;

  const { goal, resolvedIntent, continuesRunId, priorInputs } = await resolveContinuedGoal(
    input,
    inferenceModel,
  );

  if (!inferenceModel && continuesRunId) {
    inferenceModel =
      (await teamsRepo.findLatestSuccessfulAgentInferenceModel(continuesRunId)) || null;
  }

  team = await persistTeamRunPreferences(team, inferenceModel, effortOverride);

  const inputs =
    input.inputs && input.inputs.length > 0 ? input.inputs : priorInputs;
  const attachmentGoal =
    resolvedIntent.effectiveGoal?.trim() ||
    resolvedIntent.userMessage?.trim() ||
    goal;
  if (
    goalImpliesAuthoritativeAttachment(attachmentGoal) &&
    !inputs.some((row) => row.purpose === 'authoritative_input')
  ) {
    throw new TeamRunMissingAttachmentError();
  }
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

  // Re-read after persist so returned team reflects saved defaults.
  team = await teamsService.getTeam(input.teamId, input.orgId);
  const effectiveTeam: TeamDTO =
    inferenceModel || effortOverride
      ? {
          ...team,
          config: {
            ...(team.config as TeamConfig),
            ...(inferenceModel ? { defaultModel: inferenceModel } : {}),
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

  if (inferenceModel) {
    console.info(`[team-run] run=${run.id} inferenceModel=${inferenceModel}`);
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

  void orchestrator.resume(run, effectiveTeam, () => {}).catch((err) => {
    console.error(`[TeamOrchestrator] resume ${run.id} failed:`, err);
  });
}
