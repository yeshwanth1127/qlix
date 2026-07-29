import { Prisma } from '@prisma/client';

export interface PlanConfig {
  monthlyPriceInr: Prisma.Decimal;
  maxAgents: number;
  /** Free INR credit auto-deposited each month. 0 = no free credit. */
  freeMonthlyCredit: Prisma.Decimal;
  allowedModelTiers: string[];
  /** Max inbound WhatsApp messages per billing cycle. 0 = no WhatsApp. */
  whatsappMsgLimit: number;
}

export const PLAN_CONFIG: Record<string, PlanConfig> = {
  free: {
    monthlyPriceInr: new Prisma.Decimal('0'),
    maxAgents: 3,
    freeMonthlyCredit: new Prisma.Decimal('0'),
    allowedModelTiers: ['economy'],
    whatsappMsgLimit: 0,
  },
  /** 14-day trial after account creation — same caps as free until pricing ships. */
  trial: {
    monthlyPriceInr: new Prisma.Decimal('0'),
    maxAgents: 3,
    freeMonthlyCredit: new Prisma.Decimal('0'),
    allowedModelTiers: ['economy'],
    whatsappMsgLimit: 0,
  },
  starter: {
    monthlyPriceInr: new Prisma.Decimal('399'),
    maxAgents: 5,
    freeMonthlyCredit: new Prisma.Decimal('300'),
    allowedModelTiers: ['economy', 'standard'],
    whatsappMsgLimit: 500,
  },
  growth: {
    monthlyPriceInr: new Prisma.Decimal('999'),
    maxAgents: 15,
    freeMonthlyCredit: new Prisma.Decimal('900'),
    allowedModelTiers: ['economy', 'standard', 'advanced'],
    whatsappMsgLimit: 2000,
  },
  business: {
    monthlyPriceInr: new Prisma.Decimal('2999'),
    maxAgents: 50,
    freeMonthlyCredit: new Prisma.Decimal('3000'),
    allowedModelTiers: ['economy', 'standard', 'advanced', 'premium'],
    whatsappMsgLimit: 10000,
  },
  custom: {
    monthlyPriceInr: new Prisma.Decimal('0'),
    maxAgents: 0,
    freeMonthlyCredit: new Prisma.Decimal('0'),
    allowedModelTiers: ['economy', 'standard', 'advanced', 'premium'],
    whatsappMsgLimit: 0,
  },
};

/** Returns the plan config, falling back to 'free' for unknown plan names. */
export function getPlanConfig(planName: string): PlanConfig {
  return PLAN_CONFIG[planName] ?? PLAN_CONFIG['free']!;
}
