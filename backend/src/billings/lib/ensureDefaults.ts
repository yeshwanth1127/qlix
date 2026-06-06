import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

const DEFAULT_TIERS: Array<{
  name: string;
  monthlyPrice: Prisma.Decimal;
  includedSuccesses: number;
  overageRate: Prisma.Decimal;
  description: string;
}> = [
  {
    name: 'free',
    monthlyPrice: new Prisma.Decimal('0'),
    includedSuccesses: 0,
    overageRate: new Prisma.Decimal('0'),
    description: 'Development/testing',
  },
  {
    name: 'starter',
    monthlyPrice: new Prisma.Decimal('49'),
    includedSuccesses: 0,
    overageRate: new Prisma.Decimal('0'),
    description: 'Small projects',
  },
  {
    name: 'pro',
    monthlyPrice: new Prisma.Decimal('149'),
    includedSuccesses: 0,
    overageRate: new Prisma.Decimal('0'),
    description: 'Growing teams',
  },
  {
    name: 'enterprise',
    monthlyPrice: new Prisma.Decimal('999'),
    includedSuccesses: 0,
    overageRate: new Prisma.Decimal('0'),
    description: 'Large-scale operations',
  },
];

const DEFAULT_BILLING_SERVICES: ReadonlyArray<{
  serviceKey: string;
  displayName: string;
  unitPrice: string;
  sortOrder: number;
}> = [
  { serviceKey: 'passport', displayName: 'Passport', unitPrice: '0.10', sortOrder: 0 },
  { serviceKey: 'audit', displayName: 'Audit log', unitPrice: '0.05', sortOrder: 1 },
  { serviceKey: 'agent_run', displayName: 'Agent run', unitPrice: '0.00', sortOrder: 2 },
  { serviceKey: 'agent_activate_paid', displayName: 'Paid agent activation', unitPrice: '5.00', sortOrder: 3 },
];

/**
 * Ensures plan tier rows (for org.plan labels) and global billing service prices exist.
 */
export async function ensureBillingDefaults(prisma: PrismaClient): Promise<void> {
  await Promise.all(
    DEFAULT_TIERS.map((tier) =>
      prisma.pricingTier.upsert({
        where: { name: tier.name },
        update: {
          monthlyPrice: tier.monthlyPrice,
          includedSuccesses: tier.includedSuccesses,
          overageRate: tier.overageRate,
          description: tier.description,
        },
        create: {
          name: tier.name,
          monthlyPrice: tier.monthlyPrice,
          includedSuccesses: tier.includedSuccesses,
          overageRate: tier.overageRate,
          description: tier.description,
        },
      }),
    ),
  );

  for (const s of DEFAULT_BILLING_SERVICES) {
    await prisma.billingService.upsert({
      where: { serviceKey: s.serviceKey },
      update: {
        displayName: s.displayName,
        unitPrice: new Prisma.Decimal(s.unitPrice),
        sortOrder: s.sortOrder,
      },
      create: {
        serviceKey: s.serviceKey,
        displayName: s.displayName,
        unitPrice: new Prisma.Decimal(s.unitPrice),
        sortOrder: s.sortOrder,
      },
    });
  }

  const freeTier = await prisma.pricingTier.findUnique({ where: { name: 'free' } });
  if (!freeTier) {
    await prisma.pricingTier.create({
      data: {
        name: 'free',
        monthlyPrice: new Prisma.Decimal('0'),
        includedSuccesses: 0,
        overageRate: new Prisma.Decimal('0'),
        description: 'Default fallback',
      },
    });
  }
}
