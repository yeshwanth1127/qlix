import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { isBillingExempt } from '../billings/lib/isBillingExempt.js';
import { resolveOrgSubscriptionAccess } from '../billings/lib/subscriptionAccess.js';

/**
 * Blocks product mutations when the org's trial has ended and no active subscription exists.
 * Skips billing-exempt emails and super-admins. Must run after authenticateUser(true).
 */
export async function requireSubscriptionAccess(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = request.auth;
    if (!auth?.orgId) {
      response.status(401).json({ error: { code: 'unauthorized', message: 'Not signed in' } });
      return;
    }

    if (isBillingExempt(auth.email)) {
      next();
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { isSuperAdmin: true, isActive: true },
    });
    if (!user?.isActive) {
      response.status(401).json({ error: { code: 'unauthorized', message: 'Account not found' } });
      return;
    }
    if (user.isSuperAdmin) {
      next();
      return;
    }

    const snap = await resolveOrgSubscriptionAccess(auth.orgId);
    if (snap.access === 'allowed') {
      next();
      return;
    }

    response.status(403).json({
      error: {
        code: 'subscription_required',
        message: 'Your free trial has ended. Choose a subscription to continue.',
      },
    });
  } catch (err) {
    console.error('[requireSubscriptionAccess]', err);
    response.status(500).json({ error: { code: 'internal_error', message: 'Subscription check failed' } });
  }
}
