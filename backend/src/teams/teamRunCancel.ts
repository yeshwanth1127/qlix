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
  const runIds = await prisma.agentRun.findMany({
    where: { teamRunId },
    select: { id: true },
  });
  const agentRunIds = runIds.map((run) => run.id);
  const stoppedAt = new Date();
  await prisma.$transaction([
    prisma.a2ATask.updateMany({
      where: {
        runId: teamRunId,
        status: { in: ['submitted', 'working', 'input_required'] },
      },
      data: {
        status: 'canceled',
        completedAt: stoppedAt,
        errorMessage: 'Team run stopped',
      },
    }),
    prisma.teamMailboxMessage.updateMany({
      where: { teamRunId, status: 'pending' },
      data: {
        status: 'canceled',
        completedAt: stoppedAt,
        errorMessage: 'Team run stopped',
      },
    }),
    ...(agentRunIds.length > 0
      ? [prisma.runInjection.updateMany({
          where: { agentRunId: { in: agentRunIds }, consumedAt: null },
          data: { consumedAt: stoppedAt },
        })]
      : []),
  ]);
  await new WaitTriggerService().cancelForTeamRun(teamRunId);
}
