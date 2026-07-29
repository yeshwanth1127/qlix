import { Prisma, type PrismaClient } from '@prisma/client';
import type { Prisma as PrismaNamespace } from '@prisma/client';
import { billingCycleFromDateUtc } from './billingCycle.js';
import { lookupBillingUnitPrice } from './priceLookup.js';
import { isBillingExempt } from './isBillingExempt.js';
import { notifyLowBalance } from './lowBalanceNotifier.js';

export interface RecordBillingEventInput {
  orgId: string;
  userId: string;
  email: string;
  agentId?: string;
  eventType: string;
  eventKey: string;
  occurredAt?: Date;
  eventData?: unknown;
  apiEndpoint?: string;
  httpStatusCode?: number;
  responseTimeMs?: number;
}

/**
 * Two-bucket wallet debit: drains freeBalance first, then paidBalance.
 * Must be called inside a Prisma transaction.
 * Returns the wallet after debit; also triggers low-balance notification if both buckets hit 0.
 */
export async function debitWalletTwoBucket(
  tx: PrismaNamespace.TransactionClient,
  orgId: string,
  amount: Prisma.Decimal,
  successfulEventId?: string,
  prismaOuter?: PrismaClient,
): Promise<void> {
  if (amount.lte(0)) return;

  // Find or create the wallet
  const existing = await tx.wallet.findUnique({ where: { orgId } });
  const wallet =
    existing ??
    (await tx.wallet.create({
      data: { orgId, currency: 'INR', balance: new Prisma.Decimal(0), freeBalance: new Prisma.Decimal(0), paidBalance: new Prisma.Decimal(0) },
    }));

  const freeAvailable = wallet.freeBalance.greaterThan(0) ? wallet.freeBalance : new Prisma.Decimal(0);
  const fromFree = freeAvailable.gte(amount) ? amount : freeAvailable;
  const fromPaid = amount.sub(fromFree);

  // Update buckets atomically
  await tx.wallet.update({
    where: { id: wallet.id },
    data: {
      freeBalance: { decrement: fromFree },
      paidBalance: { decrement: fromPaid },
      balance: { decrement: amount },
    },
  });

  // Free-credit debit transaction
  if (fromFree.gt(0)) {
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'usage_debit',
        amount: fromFree.negated(),
        status: 'posted',
        creditKind: 'free',
        ...(successfulEventId ? { successfulEventId } : {}),
      },
    });
  }

  // Paid-credit debit transaction
  if (fromPaid.gt(0)) {
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'usage_debit',
        amount: fromPaid.negated(),
        status: 'posted',
        creditKind: 'paid',
        ...(successfulEventId ? { successfulEventId } : {}),
      },
    });
  }

  // If both buckets are now at/below 0, notify the org (deduped, async — runs outside the tx)
  const newTotal = wallet.balance.sub(amount);
  if (newTotal.lte(0) && prismaOuter) {
    // Non-blocking — don't let notification failure roll back the billing event
    notifyLowBalance(orgId, prismaOuter).catch((err) =>
      console.error(`[lowBalanceNotifier] org ${orgId}:`, err),
    );
  }
}

/**
 * Credit the paidBalance of a wallet (e.g. after a successful Razorpay payment or admin top-up).
 * Must be called outside a transaction (it opens its own).
 */
export async function creditPaidBalance(
  prisma: PrismaClient,
  orgId: string,
  amount: Prisma.Decimal,
  reason?: string,
): Promise<void> {
  if (amount.lte(0)) throw new Error('Amount must be > 0');

  await prisma.$transaction(async (tx) => {
    const existing = await tx.wallet.findUnique({ where: { orgId } });
    const wallet =
      existing ??
      (await tx.wallet.create({
        data: { orgId, currency: 'INR', balance: new Prisma.Decimal(0), freeBalance: new Prisma.Decimal(0), paidBalance: new Prisma.Decimal(0) },
      }));

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        paidBalance: { increment: amount },
        balance: { increment: amount },
      },
    });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'manual_credit',
        amount,
        status: 'posted',
        creditKind: 'paid',
      },
    });

    await tx.billingLog.create({
      data: {
        orgId,
        action: 'topup_paid',
        status: 'success',
        details: { amount: amount.toString(), reason: reason ?? null },
      },
    });
  });
}

/**
 * Record a successful billing event and debit the wallet using two-bucket logic (unless user is exempt).
 * Idempotent: if the eventKey already exists, returns successfully without re-debiting.
 */
export async function recordSuccessfulEvent(
  prisma: PrismaClient,
  input: RecordBillingEventInput,
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const billingCycle = billingCycleFromDateUtc(occurredAt);

  const price = await lookupBillingUnitPrice({ prisma, eventType: input.eventType });
  const amountCharged = price.unitPrice;

  try {
    await prisma.$transaction(async (tx) => {
      const event = await tx.successfulEvent.create({
        data: {
          orgId: input.orgId,
          userId: input.userId,
          agentId: input.agentId ?? null,
          eventType: input.eventType,
          amountCharged,
          billingCycle,
          successfulEventKey: input.eventKey,
          eventData: input.eventData as any,
          apiEndpoint: input.apiEndpoint ?? null,
          httpStatusCode: input.httpStatusCode ?? null,
          responseTimeMs: input.responseTimeMs ?? null,
          occurredAt,
        },
      });

      if (!isBillingExempt(input.email) && amountCharged.gt(0)) {
        await debitWalletTwoBucket(tx, input.orgId, amountCharged, event.id, prisma);
      }

      await tx.billingLog.create({
        data: {
          orgId: input.orgId,
          action: 'event_recorded',
          status: 'success',
          details: {
            eventType: input.eventType,
            billedServiceKey: price.serviceKey,
            billingCycle,
            amountCharged: amountCharged.toString(),
            exempt: isBillingExempt(input.email),
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return; // Idempotent — already recorded
    }
    throw error;
  }
}
