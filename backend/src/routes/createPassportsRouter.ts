import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateUser } from '../middleware/authenticateUser.js';

function truncateIdentityToken(value: string): string {
  if (value.length <= 22) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

/** Passports overview — Layer 3 agent cryptographic identity surfaced for the UI. */
export function createPassportsRouter(): Router {
  const router = Router();

  router.get('/', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      if (!org) {
        response.status(404).json({ error: { code: 'not_found', message: 'Organization not found' } });
        return;
      }

      const agents = await prisma.agent.findMany({
        where: { orgId },
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          name: true,
          did: true,
          publicKey: true,
          status: true,
          createdAt: true,
          lastActive: true,
        },
      });

      const credentialCounts = await prisma.verifiableCredential.groupBy({
        by: ['agentId'],
        where: { agentId: { in: agents.map((a) => a.id) } },
        _count: { id: true },
      });
      const countByAgentId = new Map(credentialCounts.map((c) => [c.agentId, c._count.id]));

      const workspaceKind =
        org.workspaceKind === 'organization' ? 'organization' : 'individual';

      response.json({
        workspaceKind,
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
        },
        passports: agents.map((a) => ({
          agentId: a.id,
          name: a.name,
          did: a.did,
          didShort: truncateIdentityToken(a.did),
          publicKeyFull: a.publicKey,
          publicKeyShort: truncateIdentityToken(a.publicKey),
          status: a.status,
          credentialsIssued: countByAgentId.get(a.id) ?? 0,
          createdAt: a.createdAt.toISOString(),
          lastActiveAt: a.lastActive ? a.lastActive.toISOString() : null,
        })),
      });
    } catch (error) {
      console.error('passports list error', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load passports' } });
    }
  });

  return router;
}
