import type { NextFunction, Request, Response } from 'express';
import type { OrgAction } from '../../lib/orgPermissions.js';
import { roleCan } from '../../lib/orgPermissions.js';
import { prisma } from '../../lib/prisma.js';

export function requireOrgAction(action: OrgAction) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = request.auth;
      if (!auth) {
        response.status(401).json({ error: { code: 'unauthorized', message: 'Not signed in' } });
        return;
      }
      if (!roleCan(auth.role, action)) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed' } });
        return;
      }

      if (action === 'billing') {
        const org = await prisma.organization.findUnique({
          where: { id: auth.orgId },
          select: { workspaceKind: true },
        });
        if (!org || org.workspaceKind !== 'organization') {
          response.status(403).json({
            error: { code: 'forbidden', message: 'Organization workspace required' },
          });
          return;
        }
      }

      next();
    } catch (error) {
      console.error('[requireOrgAction]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Authorization failed' } });
    }
  };
}

