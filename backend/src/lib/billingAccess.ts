import type { NextFunction, Request, Response } from 'express';
import { prisma } from './prisma.js';
import { roleCan } from './orgPermissions.js';

/**
 * Middleware gating billing/wallet/usage surfaces. Individual workspaces may always view their own
 * billing. In an organization, only roles with the `billing` capability (owner) may — this enforces
 * the product rule that org members (and admins) must not see billing. Fails closed on lookup miss.
 */
export async function assertCanViewBilling(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = request.auth!;
    if (!auth.orgId) {
      next();
      return;
    }
    const org = await prisma.organization.findUnique({
      where: { id: auth.orgId },
      select: { workspaceKind: true },
    });
    if (!org) {
      response.status(403).json({ error: { code: 'forbidden', message: 'Billing not available' } });
      return;
    }
    if (org.workspaceKind === 'individual' || roleCan(auth.role, 'billing')) {
      next();
      return;
    }
    response.status(403).json({ error: { code: 'forbidden', message: 'Billing is restricted to organization owners' } });
  } catch {
    response.status(403).json({ error: { code: 'forbidden', message: 'Billing not available' } });
  }
}
