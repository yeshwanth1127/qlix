import { prisma } from '../lib/prisma.js';
import { runBillingRollups } from '../billings/jobs/billingRollups.js';
import { runSubscriptionRenewals } from '../billings/jobs/runSubscriptionRenewals.js';
import { reconcileStaleRuns } from '../agentChat/runReconciliation.js';
import { pruneOrphanedRunnerStateDirs, pruneStaleRunnerImages } from '../cloudRunners/runnerPruning.js';

/**
 * In-process interval scheduler for jobs that previously had to be triggered by hand
 * (CLI script or an admin-panel button) — billing rollups/renewals, stale-run recovery,
 * and runner-state pruning. Safe as a single `setInterval` because the backend runs as
 * one PM2 instance (see `ecosystem.config.cjs`); if that ever changes, these need a
 * proper distributed-lock/leader-election guard first.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

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

  console.log(
    `[scheduler] started — billing every ${(billingIntervalMs / HOUR_MS).toFixed(2)}h, ` +
      `run reconciliation every ${(runReconcileIntervalMs / MINUTE_MS).toFixed(1)}m, ` +
      `pruning every ${(pruneIntervalMs / HOUR_MS).toFixed(1)}h`,
  );
}
