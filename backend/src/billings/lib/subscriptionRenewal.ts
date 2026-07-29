import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { getPlanConfig } from './subscriptionPlans.js';

export interface RenewalResult {
  orgId: string;
  planName: string;
  freeCreditsAdded: Prisma.Decimal;
  newPeriodEnd: Date;
}

/**
 * Renews a single org's subscription:
 *  1. Expires the current freeBalance (zeroed out — it doesn't carry forward)
 *  2. Deposits plan's freeMonthlyCredit into freeBalance
 *  3. Sets freeExpiresAt to end of new period
 *  4. Advances currentPeriodStart / currentPeriodEnd on OrgSubscription
 *  5. Logs to BillingLog
 */
export async function renewSubscription(orgId: string, prisma: PrismaClient): Promise<RenewalResult> {
  const sub = await prisma.orgSubscription.findUnique({
    where: { orgId },
    select: { planName: true, currentPeriodEnd: true, status: true },
  });

  if (!sub) {
    throw new Error(`No OrgSubscription found for org ${orgId}`);
  }

  if (sub.status !== 'active') {
    throw new Error(`Subscription for org ${orgId} is not active (status: ${sub.status})`);
  }

  const config = getPlanConfig(sub.planName);
  const newPeriodStart = sub.currentPeriodEnd;
  const newPeriodEnd = nextMonthStart(newPeriodStart);
  const freeCredits = config.freeMonthlyCredit;

  await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { orgId } });

    if (wallet) {
      const expiredFreeBalance = wallet.freeBalance;
      const newFreeBalance = freeCredits;
      const newBalance = newFreeBalance.add(wallet.paidBalance);

      await tx.wallet.update({
        where: { orgId },
        data: {
          freeBalance: newFreeBalance,
          balance: newBalance,
          freeExpiresAt: newPeriodEnd,
        },
      });

      // Record expiry of old free credit (if any)
      if (expiredFreeBalance.greaterThan(0)) {
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: 'free_credit_expired',
            amount: expiredFreeBalance.negated(),
            status: 'completed',
            creditKind: 'free',
          },
        });
      }

      // Record new free credit deposit
      if (freeCredits.greaterThan(0)) {
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: 'free_credit_drop',
            amount: freeCredits,
            status: 'completed',
            creditKind: 'free',
          },
        });
      }
    }

    // Advance subscription period
    await tx.orgSubscription.update({
      where: { orgId },
      data: {
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
      },
    });

    await tx.billingLog.create({
      data: {
        orgId,
        action: 'subscription_renewed',
        details: {
          planName: sub.planName,
          freeCreditsAdded: freeCredits.toFixed(2),
          newPeriodStart: newPeriodStart.toISOString(),
          newPeriodEnd: newPeriodEnd.toISOString(),
        },
        status: 'success',
      },
    });
  });

  return {
    orgId,
    planName: sub.planName,
    freeCreditsAdded: freeCredits,
    newPeriodEnd,
  };
}

function nextMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}
