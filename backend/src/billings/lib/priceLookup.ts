import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { canonicalBillingServiceKey } from './billingServiceCatalog.js';

export interface BillingUnitPriceResult {
  readonly unitPrice: Prisma.Decimal;
  readonly serviceKey: string;
  readonly displayName: string;
}

/**
 * Global per-service price. `eventType` from ingest is canonicalized (e.g. passport_verify → passport).
 * Unknown services bill at 0 until a row exists in `billing_services`.
 */
export async function lookupBillingUnitPrice(params: {
  prisma: PrismaClient;
  eventType: string;
}): Promise<BillingUnitPriceResult> {
  const { prisma, eventType } = params;
  const serviceKey = canonicalBillingServiceKey(eventType);

  const row = await prisma.billingService.findUnique({
    where: { serviceKey },
    select: { unitPrice: true, displayName: true },
  });

  if (!row) {
    return {
      unitPrice: new Prisma.Decimal('0'),
      serviceKey,
      displayName: serviceKey,
    };
  }

  return {
    unitPrice: row.unitPrice,
    serviceKey,
    displayName: row.displayName,
  };
}
