import { prisma } from '../lib/prisma.js';
import { runBillingRollups } from '../billings/jobs/billingRollups.js';
import { runSubscriptionRenewals } from '../billings/jobs/runSubscriptionRenewals.js';
import { reconcileStaleRuns } from '../agentChat/runReconciliation.js';
import { pruneOrphanedRunnerStateDirs, pruneStaleRunnerImages } from '../cloudRunners/runnerPruning.js';
import { pruneExpiredEphemeralGrants } from '../lib/ephemeralGrants.js';
import { tickEmployeeSchedules } from '../employees/employeeSchedule.service.js';
import { scheduleService } from '../schedules/schedule.service.js';
import { WaitTriggerService } from '../teams/waitTrigger.service.js';
import { TeamsRepository } from '../teams/teams.repository.js';
import { dispatchConversationOutboxOnce, fireDueConversationTimers } from '../conversations/conversationWorkers.service.js';
import { conversationPluginRegistry } from '../conversations/registry.js';

/**
 * In-process interval scheduler for jobs that previously had to be triggered by hand
 * (CLI script or an admin-panel button) — billing rollups/renewals, stale-run recovery,
 * and runner-state pruning. Safe as a single `setInterval` because the backend runs as
 * one PM2 instance (see `ecosystem.config.cjs`); if that ever changes, these need a
 * proper distributed-lock/leader-election guard first.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const waitTriggers = new WaitTriggerService();
const teamsRepo = new TeamsRepository();

function intervalMs(envVar: string, defaultHours: number): number {
  const raw = process.env[envVar]?.trim();
  const n = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n * HOUR_MS : defaultHours * HOUR_MS;
}

async function runBillingCycleJobs(): Promise<void> {
  try {
    const daily = await runBillingRollups({ prisma, mode: 'both' });
    console.log('[scheduler] billing rollup', JSON.stringify(daily));
  } catch (err) {
    console.error('[scheduler] billing rollup failed', err);
  }
  try {
    const renewals = await runSubscriptionRenewals({ prisma });
    if (renewals.renewed > 0 || renewals.failed > 0) {
      console.log('[scheduler] subscription renewals', JSON.stringify(renewals));
    }
  } catch (err) {
    console.error('[scheduler] subscription renewals failed', err);
  }
}

async function runPruneJobs(): Promise<void> {
  try {
    const orphaned = await pruneOrphanedRunnerStateDirs();
    const staleImages = await pruneStaleRunnerImages();
    if (orphaned > 0 || staleImages > 0) {
      console.log(`[scheduler] pruned ${orphaned} orphaned runner dir(s), ${staleImages} stale image(s)`);
    }
  } catch (err) {
    console.error('[scheduler] runner pruning failed', err);
  }
  try {
    const expiredGrants = await pruneExpiredEphemeralGrants();
    if (expiredGrants > 0) {
      console.log(`[scheduler] pruned ${expiredGrants} expired ephemeral grant(s)`);
    }
  } catch (err) {
    console.error('[scheduler] ephemeral grant pruning failed', err);
  }
}

async function expireWaitTriggers(): Promise<void> {
  try {
    const expired = await waitTriggers.expireDue();
    if (expired.length === 0) return;

    const teamRunIds = [...new Set(expired.map((t) => t.teamRunId).filter(Boolean))] as string[];
    for (const teamRunId of teamRunIds) {
      const run = await teamsRepo.findRun(teamRunId);
      if (!run || run.status !== 'paused') continue;

      const checkpoint = run.checkpointJson as {
        awaitingTtlSelection?: boolean;
      } | null;
      // While waiting for the user to pick a duration, ignore expiry unless the
      // provisional safety-cap wait itself is due (expireDue already selected it).
      if (checkpoint?.awaitingTtlSelection) {
        // Still expire siblings and resume — the provisional 7d cap was hit.
      }

      await waitTriggers.expireOpenWaitsForTeamRun(teamRunId);
      await teamsRepo.appendEvent(run.id, run.teamId, null, 'wait_expired', {
        reason:
          'Wait duration ended — continuing with whoever has replied so far.',
        teamRunId,
      });

      try {
        const { resumeTeamRun } = await import('../teams/teamsRunLauncher.js');
        await resumeTeamRun(teamRunId);
      } catch (err) {
        console.error(
          `[scheduler] resume after wait expiry failed run=${teamRunId}`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (expired.length > 0) {
      console.log(`[scheduler] expired ${expired.length} wait trigger(s); resumed ${teamRunIds.length} paused run(s)`);
    }
  } catch (err) {
    console.error('[scheduler] wait trigger expiry failed', err);
  }
}

function every(fn: () => Promise<void>, ms: number, initialDelayMs: number): void {
  const kickoff = setTimeout(function tick() {
    void fn();
    const handle = setInterval(() => void fn(), ms);
    handle.unref();
  }, initialDelayMs);
  kickoff.unref();
}

/** Call once at backend boot (from `main.ts`). */
export function startBackgroundScheduler(): void {
  const billingIntervalMs = intervalMs('QLIX_BILLING_CYCLE_INTERVAL_HOURS', 6);
  const runReconcileIntervalMs = intervalMs('QLIX_RUN_RECONCILE_INTERVAL_HOURS', 5 / 60);
  const pruneIntervalMs = intervalMs('QLIX_RUNNER_PRUNE_INTERVAL_HOURS', 24);

  every(runBillingCycleJobs, billingIntervalMs, 60_000);
  every(reconcileStaleRuns, runReconcileIntervalMs, 90_000);
  every(runPruneJobs, pruneIntervalMs, 3 * MINUTE_MS);
  every(expireWaitTriggers, MINUTE_MS, 55_000);
  every(async () => {
    try {
      const n = await fireDueConversationTimers();
      if (n > 0) console.log(`[scheduler] conversation timers fired=${n}`);
    } catch (err) {
      console.error('[scheduler] conversation timers failed', err);
    }
  }, 5_000, 5_000);
  every(async () => {
    try {
      const { completed, retried, dead } = await dispatchConversationOutboxOnce(
        conversationPluginRegistry.handlers(),
      );
      if (completed > 0 || retried > 0 || dead > 0) {
        console.log(`[scheduler] conversation outbox completed=${completed} retried=${retried} dead=${dead}`);
      }
    } catch (err) {
      console.error('[scheduler] conversation outbox dispatch failed', err);
    }
  }, 5_000, 5_000);
  every(async () => {
    try {
      const n = await tickEmployeeSchedules();
      if (n > 0) console.log(`[scheduler] employee schedules enqueued=${n}`);
    } catch (err) {
      console.error('[scheduler] employee schedules failed', err);
    }
  }, MINUTE_MS, 45_000);

  every(async () => {
    try {
      const n = await scheduleService.tick();
      if (n > 0) console.log(`[scheduler] scheduled events fired=${n}`);
    } catch (err) {
      console.error('[scheduler] scheduled events failed', err);
    }
  }, MINUTE_MS, 50_000);

  console.log(
    `[scheduler] started — billing every ${(billingIntervalMs / HOUR_MS).toFixed(2)}h, ` +
      `run reconciliation every ${(runReconcileIntervalMs / MINUTE_MS).toFixed(1)}m, ` +
      `pruning every ${(pruneIntervalMs / HOUR_MS).toFixed(1)}h, ` +
      `employee schedules every 1m, scheduled events every 1m`,
  );
}
