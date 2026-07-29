import { prisma } from '../../lib/prisma.js';
import { isBillingExempt } from './isBillingExempt.js';
import { trialPeriodDates, TRIAL_DAYS, TRIAL_PLAN_NAME } from './trialSubscription.js';

export type SubscriptionStatus = 'trialing' | 'active' | 'expired' | 'canceled' | 'past_due';
export type SubscriptionAccess = 'allowed' | 'required';

export interface OrgSubscriptionSnapshot {
  status: SubscriptionStatus;
  planName: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  access: SubscriptionAccess;
}

const ALLOWED_STATUSES = new Set<SubscriptionStatus>(['trialing', 'active']);

function asStatus(raw: string): SubscriptionStatus {
  if (
    raw === 'trialing' ||
    raw === 'active' ||
    raw === 'expired' ||
    raw === 'canceled' ||
    raw === 'past_due'
  ) {
    return raw;
  }
  return 'expired';
}

function expiredSnapshot(): OrgSubscriptionSnapshot {
  return {
    status: 'expired',
    planName: TRIAL_PLAN_NAME,
    trialEndsAt: null,
    currentPeriodEnd: null,
    access: 'required',
  };
}

/** Create a trial (or expired trial) row for orgs that predate this feature. */
async function ensureSubscriptionRow(orgId: string) {
  const existing = await prisma.orgSubscription.findUnique({ where: { orgId } });
  if (existing) return existing;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, plan: true, createdAt: true },
  });
  if (!org) return null;

  const paidPlan = org.plan !== 'free' && org.plan !== TRIAL_PLAN_NAME && org.plan !== '';
  if (paidPlan) {
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return prisma.orgSubscription.create({
      data: {
        orgId,
        planName: org.plan,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    });
  }

  const now = new Date();
  const { currentPeriodStart, currentPeriodEnd } = trialPeriodDates(org.createdAt);
  const stillInTrial = now.getTime() <= currentPeriodEnd.getTime();
  const created = await prisma.orgSubscription.create({
    data: {
      orgId,
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
      where: { id: orgId },
      data: { plan: TRIAL_PLAN_NAME },
    });
  }
  return created;
}

/**
 * Resolve subscription access for an org. Lazily flips `trialing` → `expired` when the period ends.
 * Missing rows are backfilled from org.createdAt (14-day trial window).
 */
export async function resolveOrgSubscriptionAccess(
  orgId: string,
  opts?: { skipGate?: boolean },
): Promise<OrgSubscriptionSnapshot> {
  const sub = await ensureSubscriptionRow(orgId);
  if (!sub) return expiredSnapshot();

  let status = asStatus(sub.status);
  const now = Date.now();
  const periodEndMs = sub.currentPeriodEnd.getTime();

  if (status === 'trialing' && now > periodEndMs) {
    await prisma.orgSubscription.update({
      where: { id: sub.id },
      data: { status: 'expired' },
    });
    status = 'expired';
  }

  const isTrialFamily = status === 'trialing' || sub.planName === TRIAL_PLAN_NAME;
  const trialEndsAt =
    isTrialFamily || status === 'expired'
      ? sub.currentPeriodEnd.toISOString()
      : null;

  let access: SubscriptionAccess = ALLOWED_STATUSES.has(status) ? 'allowed' : 'required';
  // Still in an active paid period counts even if status is past_due until period end? Plan says
  // only trialing (valid) or active. past_due / canceled / expired → required.
  if (opts?.skipGate) access = 'allowed';

  return {
    status,
    planName: sub.planName,
    trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
    access,
  };
}

export async function sessionOrganizationPayload(
  organization: {
    id: string;
    name: string;
    slug: string;
    workspaceKind: string;
    plan: string;
  },
  opts?: { email?: string; isSuperAdmin?: boolean },
): Promise<{
  id: string;
  name: string;
  slug: string;
  workspaceKind: string;
  plan: string;
  subscription: OrgSubscriptionSnapshot;
}> {
  const skipGate =
    Boolean(opts?.isSuperAdmin) || (opts?.email ? isBillingExempt(opts.email) : false);
  const subscription = await resolveOrgSubscriptionAccess(organization.id, { skipGate });
  // Super-admin / billing-exempt always get access allowed in the session payload.
  if (skipGate) {
    subscription.access = 'allowed';
  }
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    workspaceKind: organization.workspaceKind,
    plan: organization.plan,
    subscription,
  };
}
