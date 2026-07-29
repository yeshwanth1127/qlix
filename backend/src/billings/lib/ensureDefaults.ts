import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { trialPeriodDates, TRIAL_DAYS, TRIAL_PLAN_NAME } from './trialSubscription.js';

const DEFAULT_TIERS: Array<{
  name: string;
  monthlyPrice: Prisma.Decimal;
  includedSuccesses: number;
  overageRate: Prisma.Decimal;
  description: string;
  maxAgents: number;
  freeMonthlyCredit: Prisma.Decimal;
  allowedModelTiers: string[];
  whatsappMsgLimit: number;
}> = [
  {
    name: 'free',
    monthlyPrice: new Prisma.Decimal('0'),
    includedSuccesses: 0,
    overageRate: new Prisma.Decimal('0'),
    description: 'Development/testing',
    maxAgents: 3,
    freeMonthlyCredit: new Prisma.Decimal('0'),
    allowedModelTiers: ['economy'],
    whatsappMsgLimit: 0,
  },
  {
    name: 'trial',
    monthlyPrice: new Prisma.Decimal('0'),
    includedSuccesses: 0,
    overageRate: new Prisma.Decimal('0'),
    description: '14-day free trial',
    maxAgents: 3,
    freeMonthlyCredit: new Prisma.Decimal('0'),
    allowedModelTiers: ['economy'],
    whatsappMsgLimit: 0,
  },
  {
    name: 'starter',
    monthlyPrice: new Prisma.Decimal('399'),
    includedSuccesses: 0,
    overageRate: new Prisma.Decimal('0'),
    description: 'Small projects',
    maxAgents: 5,
    freeMonthlyCredit: new Prisma.Decimal('300'),
    allowedModelTiers: ['economy', 'standard'],
    whatsappMsgLimit: 500,
  },
  {
    name: 'growth',
    monthlyPrice: new Prisma.Decimal('999'),
    includedSuccesses: 0,
    overageRate: new Prisma.Decimal('0'),
    description: 'Growing teams',
    maxAgents: 15,
    freeMonthlyCredit: new Prisma.Decimal('900'),
    allowedModelTiers: ['economy', 'standard', 'advanced'],
    whatsappMsgLimit: 2000,
  },
  {
    name: 'business',
    monthlyPrice: new Prisma.Decimal('2999'),
    includedSuccesses: 0,
    overageRate: new Prisma.Decimal('0'),
    description: 'Large-scale operations',
    maxAgents: 50,
    freeMonthlyCredit: new Prisma.Decimal('3000'),
    allowedModelTiers: ['economy', 'standard', 'advanced', 'premium'],
    whatsappMsgLimit: 10000,
  },
  {
    name: 'custom',
    monthlyPrice: new Prisma.Decimal('0'),
    includedSuccesses: 0,
    overageRate: new Prisma.Decimal('0'),
    description: 'Negotiated enterprise plan',
    maxAgents: 0,
    freeMonthlyCredit: new Prisma.Decimal('0'),
    allowedModelTiers: ['economy', 'standard', 'advanced', 'premium'],
    whatsappMsgLimit: 0,
  },
];

const DEFAULT_BILLING_SERVICES: ReadonlyArray<{
  serviceKey: string;
  displayName: string;
  unitPrice: string;
  sortOrder: number;
}> = [
  { serviceKey: 'passport', displayName: 'Passport', unitPrice: '8.30', sortOrder: 0 },
  { serviceKey: 'audit', displayName: 'Audit log', unitPrice: '4.15', sortOrder: 1 },
  { serviceKey: 'agent_run', displayName: 'Agent run', unitPrice: '0.00', sortOrder: 2 },
  { serviceKey: 'agent_activate_paid', displayName: 'Paid agent activation', unitPrice: '415.00', sortOrder: 3 },
  { serviceKey: 'jit_detection', displayName: 'JIT approval request', unitPrice: '1.00', sortOrder: 4 },
  { serviceKey: 'whatsapp_inbound', displayName: 'WhatsApp inbound message', unitPrice: '0.00', sortOrder: 5 },
];

const DEFAULT_MODEL_TIERS: ReadonlyArray<{
  tierKey: string;
  displayName: string;
  pricePerStep: string;
  modelPrefixes: string[];
  sortOrder: number;
}> = [
  {
    tierKey: 'economy',
    displayName: 'Economy',
    pricePerStep: '0.50',
    modelPrefixes: [
      'openrouter/google/gemini-flash',
      'openrouter/google/gemini-2.0-flash',
      'openrouter/anthropic/claude-haiku',
      'openrouter/meta-llama/llama-3',
      'openrouter/mistralai/mistral-7b',
    ],
    sortOrder: 0,
  },
  {
    tierKey: 'standard',
    displayName: 'Standard',
    pricePerStep: '2.00',
    modelPrefixes: [
      'openrouter/anthropic/claude-sonnet',
      'openrouter/openai/gpt-4o-mini',
      'openrouter/google/gemini-pro',
      'openrouter/google/gemini-1.5-pro',
    ],
    sortOrder: 1,
  },
  {
    tierKey: 'advanced',
    displayName: 'Advanced',
    pricePerStep: '5.00',
    modelPrefixes: [
      'openrouter/openai/gpt-4o',
      'openrouter/openai/gpt-4-turbo',
      'openrouter/google/gemini-2.0-pro',
      'openrouter/anthropic/claude-opus',
    ],
    sortOrder: 2,
  },
  {
    tierKey: 'premium',
    displayName: 'Premium',
    pricePerStep: '15.00',
    modelPrefixes: [
      'openrouter/anthropic/claude-opus-4',
      'openrouter/openai/o1',
      'openrouter/openai/o3',
      'openrouter/google/gemini-ultra',
    ],
    sortOrder: 3,
  },
];

/**
 * Ensures plan tier rows, billing services, and model tier rows exist with correct defaults.
 * Safe to call on every server start — uses upsert throughout.
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
          maxAgents: tier.maxAgents,
          freeMonthlyCredit: tier.freeMonthlyCredit,
          allowedModelTiers: tier.allowedModelTiers,
          whatsappMsgLimit: tier.whatsappMsgLimit,
        },
        create: {
          name: tier.name,
          monthlyPrice: tier.monthlyPrice,
          includedSuccesses: tier.includedSuccesses,
          overageRate: tier.overageRate,
          description: tier.description,
          maxAgents: tier.maxAgents,
          freeMonthlyCredit: tier.freeMonthlyCredit,
          allowedModelTiers: tier.allowedModelTiers,
          whatsappMsgLimit: tier.whatsappMsgLimit,
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

  for (const mt of DEFAULT_MODEL_TIERS) {
    await prisma.modelTier.upsert({
      where: { tierKey: mt.tierKey },
      update: {
        displayName: mt.displayName,
        pricePerStep: new Prisma.Decimal(mt.pricePerStep),
        modelPrefixes: mt.modelPrefixes,
        sortOrder: mt.sortOrder,
      },
      create: {
        tierKey: mt.tierKey,
        displayName: mt.displayName,
        pricePerStep: new Prisma.Decimal(mt.pricePerStep),
        modelPrefixes: mt.modelPrefixes,
        sortOrder: mt.sortOrder,
      },
    });
  }

  await ensureOrphanedOrgSubscriptions(prisma);
}

/**
 * Migration guard: auto-create OrgSubscription for orgs that have none.
 * - Non-free paid plans (legacy admin upgrades) → active period through month end.
 * - free / trial / missing → 14-day trial window from org.createdAt (expired if past).
 */
async function ensureOrphanedOrgSubscriptions(prisma: PrismaClient): Promise<void> {
  const orgsWithoutSub = await prisma.organization.findMany({
    where: { subscription: null },
    select: { id: true, plan: true, createdAt: true },
  });

  if (orgsWithoutSub.length === 0) return;

  const now = new Date();
  const monthPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  await Promise.all(
    orgsWithoutSub.map(async (org) => {
      const paidPlan = org.plan !== 'free' && org.plan !== TRIAL_PLAN_NAME && org.plan !== '';
      if (paidPlan) {
        await prisma.orgSubscription.create({
          data: {
            orgId: org.id,
            planName: org.plan,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: monthPeriodEnd,
          },
        });
        return;
      }

      const { currentPeriodStart, currentPeriodEnd } = trialPeriodDates(org.createdAt);
      const stillInTrial = now.getTime() <= currentPeriodEnd.getTime();
      await prisma.orgSubscription.create({
        data: {
          orgId: org.id,
          planName: TRIAL_PLAN_NAME,
          status: stillInTrial ? 'trialing' : 'expired',
          currentPeriodStart,
          currentPeriodEnd: stillInTrial
            ? currentPeriodEnd
            : new Date(org.createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
        },
      });
      if (org.plan !== TRIAL_PLAN_NAME) {
        await prisma.organization.update({
          where: { id: org.id },
          data: { plan: TRIAL_PLAN_NAME },
        });
      }
    }),
  );
}
