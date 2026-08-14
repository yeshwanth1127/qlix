import { prisma } from '../lib/prisma.js';
import { cancelAgentRunsForTeamRun } from '../agentChat/agentRunService.js';
import { WaitTriggerService } from './waitTrigger.service.js';

/**
 * Stop workers for a team run *before* flipping TeamRun to canceled.
 * Canceling the team row first disarms WhatsApp wait-mode and lets in-flight
 * tools fall through to live send.
 */
export async function stopInFlightTeamRunWorkers(teamRunId: string): Promise<void> {
  await cancelAgentRunsForTeamRun(teamRunId, 'Team run stopped');
  await prisma.a2ATask.updateMany({
    where: {
      runId: teamRunId,
      status: { in: ['submitted', 'working', 'input_required'] },
    },
    data: {
      status: 'canceled',
      completedAt: new Date(),
      errorMessage: 'Team run stopped',
    },
  });
  await new WaitTriggerService().cancelForTeamRun(teamRunId);
}
