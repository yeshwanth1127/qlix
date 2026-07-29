import { prisma } from '../lib/prisma.js';
import { TeamsRepository } from '../teams/teams.repository.js';

/** Matches the reactive per-agent threshold in `createAgentChatRouter.ts`'s `recoverStaleRuns`. */
const STALE_AGENT_RUN_MS = 5 * 60_000;

/** Team runs hop across multiple agents and can sit in a JIT approval wait; give them more room. */
const STALE_TEAM_RUN_MS = 15 * 60_000;

/**
 * Global sweep for `AgentRun` rows left at `status: 'running'` by a backend crash/restart —
 * the existing `recoverStaleRuns` in `createAgentChatRouter.ts` only fires reactively, the
 * next time that specific agent is messaged again. This requeues them so an abandoned agent
 * (nobody happens to message it again) doesn't stay stuck forever.
 */
export async function reconcileStaleAgentRuns(): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_AGENT_RUN_MS);
  const result = await prisma.agentRun.updateMany({
    where: { status: 'running', startedAt: { lt: staleBefore }, finishedAt: null },
    data: { status: 'queued', startedAt: null },
  });
  return result.count;
}

/**
 * Global sweep for `TeamRun` rows left at `status: 'running'` by a backend crash/restart.
 * Unlike a single AgentRun, a team run's multi-agent handoff state isn't safely resumable,
 * so stuck runs are marked `failed` with a clear reason instead of requeued.
 */
export async function reconcileStaleTeamRuns(): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_TEAM_RUN_MS);
  const stuck = await prisma.teamRun.findMany({
    where: { status: 'running', startedAt: { lt: staleBefore }, completedAt: null },
    select: { id: true, teamId: true },
    take: 100,
  });
  if (stuck.length === 0) return 0;

  const repo = new TeamsRepository();
  for (const run of stuck) {
    await repo.updateRunStatus(run.id, 'failed', {
      completedAt: new Date(),
      errorMessage: 'Run stalled and was not completed before the backend restarted.',
    });
    await repo
      .appendEvent(run.id, run.teamId, null, 'run_failed', { reason: 'stale_after_restart' })
      .catch(() => {});
  }
  return stuck.length;
}

export async function reconcileStaleRuns(): Promise<void> {
  const [agents, teams] = await Promise.all([
    reconcileStaleAgentRuns().catch((err) => {
      console.error('[runReconciliation] agent run sweep failed', err);
      return 0;
    }),
    reconcileStaleTeamRuns().catch((err) => {
      console.error('[runReconciliation] team run sweep failed', err);
      return 0;
    }),
  ]);
  if (agents > 0 || teams > 0) {
    console.log(`[runReconciliation] requeued ${agents} agent run(s), failed ${teams} team run(s)`);
  }
}
