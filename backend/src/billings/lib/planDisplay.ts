/**
 * Futuristic display names for subscription plan slugs.
 * Internal DB keys stay free|trial|starter|growth|business|custom.
 */

export const PLAN_DISPLAY: Record<
  string,
  { displayName: string; blurb: string }
> = {
  free: {
    displayName: 'Spark',
    blurb: 'Ignite your first agents — economy models, light footprint.',
  },
  trial: {
    displayName: 'Ignition',
    blurb: 'Full trial burn — explore Auto routing before you commit.',
  },
  starter: {
    displayName: 'Nova',
    blurb: 'Solo builders shipping production agents with Auto standard.',
  },
  growth: {
    displayName: 'Quasar',
    blurb: 'Teams at scale — advanced pins when you need raw power.',
  },
  business: {
    displayName: 'Helix',
    blurb: 'Org-wide control, premium models, and high message volume.',
  },
  custom: {
    displayName: 'Apex',
    blurb: 'Negotiated orbit — limits and models tailored to you.',
  },
};

export function planDisplayName(planSlug: string): string {
  return PLAN_DISPLAY[planSlug]?.displayName ?? planSlug;
}

export function planBlurb(planSlug: string): string {
  return PLAN_DISPLAY[planSlug]?.blurb ?? '';
}
