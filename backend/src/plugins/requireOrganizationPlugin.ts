import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';

/**
 * Product-plugin access boundary for authenticated organization routes.
 *
 * Navigation visibility is only a convenience. Routes that belong to an
 * optional product capability must also enforce its active OrgPlugin row.
 */
export function requireOrganizationPlugin(pluginId: string) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = request.auth?.orgId;
      if (!orgId) {
        response.status(403).json({
          error: { code: 'organization_required', message: 'An organization workspace is required.' },
        });
        return;
      }

      const plugin = await prisma.orgPlugin.findUnique({
        where: { orgId_pluginId: { orgId, pluginId } },
        select: { enabled: true, lifecycleState: true },
      });
      if (!plugin?.enabled || plugin.lifecycleState !== 'active') {
        response.status(403).json({
          error: {
            code: 'plugin_not_active',
            message: `Enable the ${pluginId} plugin before using this capability.`,
          },
        });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
