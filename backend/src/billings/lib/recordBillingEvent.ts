import { Prisma, type PrismaClient } from '@prisma/client';
import { billingCycleFromDateUtc } from './billingCycle.js';
import { lookupBillingUnitPrice } from './priceLookup.js';
import { isBillingExempt } from './isBillingExempt.js';

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
 * Record a successful billing event and debit the wallet (unless user is exempt).
 * Idempotent: if the eventKey already exists, returns successfully without re-debiting.
 */
export async function recordSuccessfulEvent(
  prisma: PrismaClient,
  input: RecordBillingEventInput,
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const billingCycle = billingCycleFromDateUtc(occurredAt);

  // Lookup price globally
  const price = await lookupBillingUnitPrice({
    prisma,
    eventType: input.eventType,
  });
  const amountCharged = price.unitPrice;

  try {
    await prisma.$transaction(async (tx) => {
      // Always create the event row (for auditing)
      await tx.successfulEvent.create({
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

      // Only debit wallet if user is not exempt
      if (!isBillingExempt(input.email) && amountCharged.gt(0)) {
        const wallet = await tx.wallet.findUnique({ where: { orgId: input.orgId } });
        const orgWallet =
          wallet ??
          (await tx.wallet.create({
            data: { orgId: input.orgId, currency: 'USD', balance: 0 },
          }));

        await tx.wallet.update({
          where: { id: orgWallet.id },
          data: { balance: { decrement: amountCharged } },
        });

        await tx.transaction.create({
          data: {
            walletId: orgWallet.id,
            type: 'usage_debit',
            amount: amountCharged.neg(),
            status: 'posted',
          },
        });
      }

      // Log the action
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
    // Idempotent: if unique constraint violation, the event was already recorded
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return;
    }
    throw error;
  }
}
