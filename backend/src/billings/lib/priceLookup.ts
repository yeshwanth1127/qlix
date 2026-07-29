import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { canonicalBillingServiceKey } from './billingServiceCatalog.js';

export interface ModelTierPriceResult {
  readonly pricePerStep: Prisma.Decimal;
  readonly tierKey: string;
  readonly displayName: string;
}

/**
 * Resolves an OpenRouter model id (e.g. "openrouter/anthropic/claude-sonnet-4-6") to a
 * ModelTier by prefix matching, and returns the per-step price in INR.
 * Falls back to the "economy" tier if no prefix matches.
 */
export async function lookupModelTierPrice(params: {
  prisma: PrismaClient;
  modelId: string;
}): Promise<ModelTierPriceResult> {
  const { prisma, modelId } = params;
  const tiers = await prisma.modelTier.findMany({ orderBy: [{ sortOrder: 'asc' }] });

  for (const tier of tiers) {
    for (const prefix of tier.modelPrefixes) {
      if (modelId.startsWith(prefix)) {
        return { pricePerStep: tier.pricePerStep, tierKey: tier.tierKey, displayName: tier.displayName };
      }
    }
  }

  // Fallback: economy tier
  const economy = tiers.find((t) => t.tierKey === 'economy');
  if (economy) {
    return { pricePerStep: economy.pricePerStep, tierKey: economy.tierKey, displayName: economy.displayName };
  }

  return { pricePerStep: new Prisma.Decimal('0.50'), tierKey: 'economy', displayName: 'Economy' };
}

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
