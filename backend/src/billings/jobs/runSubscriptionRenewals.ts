import { PrismaClient } from '@prisma/client';
import { renewSubscription } from '../lib/subscriptionRenewal.js';

/**
 * Finds all active OrgSubscription rows whose currentPeriodEnd is in the past
 * and renews them (drops new free credit, advances period).
 *
 * Run daily via cron or trigger manually via the admin API.
 */
export async function runSubscriptionRenewals(params: {
  prisma: PrismaClient;
  dryRun?: boolean;
}): Promise<{ renewed: number; failed: number; errors: Array<{ orgId: string; error: string }> }> {
  const { prisma, dryRun = false } = params;

  const now = new Date();
  const due = await prisma.orgSubscription.findMany({
    where: {
      status: 'active',
      currentPeriodEnd: { lte: now },
    },
    select: { orgId: true, planName: true },
  });

  let renewed = 0;
  let failed = 0;
  const errors: Array<{ orgId: string; error: string }> = [];

  for (const sub of due) {
    if (dryRun) {
      console.log(`[DryRun] Would renew org ${sub.orgId} (plan: ${sub.planName})`);
      renewed += 1;
      continue;
    }
    try {
      const result = await renewSubscription(sub.orgId, prisma);
      console.log(
        `Renewed org ${result.orgId} (plan: ${result.planName}) — free credits: ₹${result.freeCreditsAdded.toFixed(2)} — next period ends: ${result.newPeriodEnd.toISOString()}`,
      );
      renewed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to renew org ${sub.orgId}: ${msg}`);
      errors.push({ orgId: sub.orgId, error: msg });
      failed += 1;
    }
  }

  console.log(`Subscription renewal complete — renewed: ${renewed}, failed: ${failed}`);
  return { renewed, failed, errors };
}

// ── CLI entry point ──────────────────────────────────────────────────────────
// Usage: npx tsx src/billings/jobs/runSubscriptionRenewals.ts [--dry-run]
if (process.argv[1]?.endsWith('runSubscriptionRenewals.ts') || process.argv[1]?.endsWith('runSubscriptionRenewals.js')) {
  const prisma = new PrismaClient();
  const dryRun = process.argv.includes('--dry-run');
  runSubscriptionRenewals({ prisma, dryRun })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
