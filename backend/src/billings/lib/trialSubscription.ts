export const TRIAL_DAYS = 14;
export const TRIAL_PLAN_NAME = 'trial';

export function trialPeriodDates(from: Date = new Date()): {
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
} {
  const currentPeriodStart = from;
  const currentPeriodEnd = new Date(from.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  return { currentPeriodStart, currentPeriodEnd };
}

/** Prisma create data for a new org's 14-day trial subscription. */
export function trialSubscriptionCreateData(orgId: string, from: Date = new Date()) {
  const { currentPeriodStart, currentPeriodEnd } = trialPeriodDates(from);
  return {
    orgId,
    planName: TRIAL_PLAN_NAME,
    status: 'trialing' as const,
    currentPeriodStart,
    currentPeriodEnd,
  };
}
