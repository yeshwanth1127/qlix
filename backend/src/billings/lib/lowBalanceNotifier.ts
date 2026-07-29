import type { PrismaClient } from '@prisma/client';

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Sends a low-balance notification for an org, deduped to at most once per 24h.
 * Records a BillingLog row for deduplication and audit.
 * Non-blocking: caller should fire-and-forget this function.
 */
export async function notifyLowBalance(orgId: string, prisma: PrismaClient): Promise<void> {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);

  const recent = await prisma.billingLog.findFirst({
    where: {
      orgId,
      action: 'low_balance_notified',
      createdAt: { gte: cutoff },
    },
    select: { id: true },
  });

  if (recent) return; // Already notified recently

  // Record the notification in the log
  await prisma.billingLog.create({
    data: {
      orgId,
      action: 'low_balance_notified',
      status: 'success',
      details: { notifiedAt: new Date().toISOString() },
    },
  });

  // TODO (Phase 3 / WhatsApp integration): send push notification or WhatsApp message
  // to org owner users. For now, the BillingLog entry is the canonical record
  // that can be polled by a dashboard or alerting system.
  console.log(`[lowBalanceNotifier] Wallet empty for org ${orgId} — notification logged.`);
}
