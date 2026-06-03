import { Router } from 'express';
import type { Request, Response } from 'express';
import { AgentsService } from '../agents/agents.service.js';
import { getPlatformIdentity } from '../credentials/platformIdentity.js';

/**
 * Public, unauthenticated endpoints for external verifiers.
 * - GET /api/v1/passport/:did  → agent identity + non-revoked VCs (signature included)
 * - GET /.well-known/did.json  → platform DID document with signing public key
 */
export function createPublicPassportRouter(): Router {
  const router = Router();
  const service = new AgentsService();

  router.get('/api/v1/passport/:did', async (request: Request, response: Response) => {
    try {
      const did = String(request.params.did);
      const agent = await service.getAgentByDid(did);
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      const credentials = (await service.listCredentials(agent.id)).filter((c) => !c.revokedAt);
      response.json({
        did: agent.did,
        name: agent.name,
        status: agent.status,
        publicKey: agent.publicKey,
        runtime: agent.runtime,
        model: agent.model,
        localInferenceMode: agent.localInferenceMode,
        permissionScopes: agent.permissionScopes,
        jitScopes: agent.jitScopes,
        alwaysScopes: agent.alwaysScopes,
        createdAt: agent.createdAt,
        credentials: credentials.map((c) => ({
          id: c.id,
          type: c.type,
          issuerDid: c.issuerDid,
          subjectDid: c.subjectDid,
          claims: c.claims,
          signature: c.signature,
          issuedAt: c.issuedAt,
          expiresAt: c.expiresAt,
        })),
      });
    } catch (err) {
      console.error('passport public lookup error', err);
      response.status(500).json({
        error: { code: 'passport_failed', message: 'Failed to load passport' },
      });
    }
  });

  router.get('/.well-known/did.json', async (_request: Request, response: Response) => {
    try {
      const platform = await getPlatformIdentity();
      response.json({
        '@context': 'https://www.w3.org/ns/did/v1',
        id: platform.did,
        verificationMethod: [
          {
            id: `${platform.did}#key-1`,
            type: 'Ed25519VerificationKey2020',
            controller: platform.did,
            publicKeyHex: platform.publicKeyHex,
          },
        ],
        assertionMethod: [`${platform.did}#key-1`],
      });
    } catch (err) {
      console.error('did.json error', err);
      response.status(500).json({
        error: { code: 'did_doc_failed', message: 'Failed to load platform DID document' },
      });
    }
  });

  return router;
}
