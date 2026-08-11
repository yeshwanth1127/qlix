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
