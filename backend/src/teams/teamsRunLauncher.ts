import type { TeamDTO, TeamRunDTO, TeamRunReplyChannel, TeamRunSourceChannel } from './teams.types.js';
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
  );

  const team = await teamsService.getTeam(input.teamId, input.orgId);

  if (sourceChannel === 'whatsapp' && input.source?.connectorId) {
    await teamsRepo.upsertChannelSession({
      connectorId: input.source.connectorId,
      teamRunId: run.id,
      teamId: team.id,
      userId: input.userId,
    });
  }

  orchestrator.execute(run, team, () => {}).catch((err) => {
    console.error(`[TeamOrchestrator] run ${run.id} failed:`, err);
  });

  return { run, team };
}
