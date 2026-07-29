import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { getPlatformIdentity } from '../credentials/platformIdentity.js';

/**
 * Workspace-level view backing the "Credentials" dashboard page (previously a
 * placeholder): the platform's own DID document (what every VC is signed by) plus
 * every Verifiable Credential issued to this workspace's agents.
 */
export function createCredentialsRouter(): Router {
  const router = Router();

  router.get('/', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const platform = await getPlatformIdentity();

      const agents = await prisma.agent.findMany({
        where: { orgId },
        select: { id: true, name: true },
      });
      const nameByAgentId = new Map(agents.map((a) => [a.id, a.name]));
      const agentIds = agents.map((a) => a.id);

      const vcs = await prisma.verifiableCredential.findMany({
        where: { agentId: { in: agentIds } },
        orderBy: { issuedAt: 'desc' },
        select: {
          id: true,
          agentId: true,
          agentDid: true,
          type: true,
          issuedAt: true,
          expiresAt: true,
          revokedAt: true,
        },
        take: 500,
      });

      response.json({
        platform: {
          did: platform.did,
          publicKey: platform.publicKeyHex,
        },
        credentials: vcs.map((v) => ({
          id: v.id,
          agentId: v.agentId,
          agentName: (v.agentId && nameByAgentId.get(v.agentId)) ?? 'Deleted agent',
          agentDid: v.agentDid,
          type: v.type,
          issuedAt: v.issuedAt.toISOString(),
          expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
          revokedAt: v.revokedAt ? v.revokedAt.toISOString() : null,
        })),
      });
    } catch (err) {
      console.error('credentials list error', err);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load credentials' } });
    }
  });

  return router;
}
