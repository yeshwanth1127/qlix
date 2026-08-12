import type {
  TeamConfig,
  TeamDTO,
  TeamRunDTO,
  TeamRunReplyChannel,
  TeamRunSourceChannel,
} from './teams.types.js';
import { TeamOrchestrator } from './teamOrchestrator.js';
import { TeamsRepository } from './teams.repository.js';
import { TeamsService } from './teams.service.js';

const orchestrator = new TeamOrchestrator();
const teamsService = new TeamsService();
const teamsRepo = new TeamsRepository();

export interface LaunchTeamRunInput {
  teamId: string;
  orgId: string;
  userId: string;
  goal: string;
  backendUrl?: string;
  /** Overrides team.config.defaultModel for this execution only. */
  inferenceModel?: string;
  source?: {
    channel: TeamRunSourceChannel;
    connectorId?: string;
  };
  replyChannel?: TeamRunReplyChannel;
}

export async function launchTeamRun(input: LaunchTeamRunInput): Promise<{
  run: TeamRunDTO;
  team: TeamDTO;
}> {
  const sourceChannel = input.source?.channel ?? 'web';
  const run = await teamsService.startRun(
    input.teamId,
    input.orgId,
    input.userId,
    input.goal,
    {
      sourceChannel,
      sourceConnectorId: input.source?.connectorId ?? null,
      replyChannel: input.replyChannel,
    },
    input.backendUrl,
  );

  const team = await teamsService.getTeam(input.teamId, input.orgId);
  const modelOverride = input.inferenceModel?.trim();
  const effectiveTeam: TeamDTO = modelOverride
    ? {
        ...team,
        config: {
          ...(team.config as TeamConfig),
          defaultModel: modelOverride,
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
