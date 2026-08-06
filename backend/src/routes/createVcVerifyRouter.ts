import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { verifySignature } from '../agents/keypair.js';
import { getPlatformIdentity } from '../credentials/platformIdentity.js';
import { prisma } from '../lib/prisma.js';

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const inner = entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',');
  return `{${inner}}`;
}

const verifyBody = z.object({
  /** Signed claims payload pieces (as issued). */
  type: z.string().min(1).optional(),
  issuerDid: z.string().min(1).optional(),
  subjectDid: z.string().min(1).optional(),
  claims: z.unknown().optional(),
  issuedAt: z.string().optional(),
  signature: z.string().min(1).optional(),
  /** Or look up by stored credential id. */
  credentialId: z.string().min(1).optional(),
});

/**
 * Public Exora VC verify API — external apps can prove an agent credential is valid.
 * POST /api/v1/verify/vc
 */
export function createVcVerifyRouter(): Router {
  const router = Router();

  router.post('/vc', async (req: Request, res: Response) => {
    const parsed = verifyBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'Invalid verify payload' } });
      return;
    }

    let type = parsed.data.type;
    let issuerDid = parsed.data.issuerDid;
    let subjectDid = parsed.data.subjectDid;
    let claims = parsed.data.claims;
    let issuedAt = parsed.data.issuedAt;
    let signature = parsed.data.signature;

    if (parsed.data.credentialId) {
      const row = await prisma.verifiableCredential.findUnique({
        where: { id: parsed.data.credentialId },
      });
      if (!row) {
        res.status(404).json({ valid: false, error: { code: 'not_found' } });
        return;
      }
      if (row.revokedAt) {
        res.json({
          valid: false,
          reason: 'revoked',
          revokedAt: row.revokedAt.toISOString(),
        });
        return;
      }
      type = row.type;
      issuerDid = row.issuerDid;
      subjectDid = row.subjectDid;
      claims = row.claims;
      issuedAt = row.issuedAt.toISOString();
      signature = row.signature;
    }

    if (!type || !issuerDid || !subjectDid || !signature || !issuedAt) {
      res.status(400).json({
        valid: false,
        error: { code: 'incomplete_credential', message: 'type, issuer, subject, issuedAt, signature required' },
      });
      return;
    }

    try {
      const platform = await getPlatformIdentity();
      const payloadObject = {
        issuer: issuerDid,
        subject: subjectDid,
        type,
        claims,
        issuedAt,
      };
      const payload = canonicalize(payloadObject);
      const ok = await verifySignature(payload, signature, platform.publicKeyHex);
      res.json({
        valid: ok,
        issuerDid,
        subjectDid,
        type,
        verifiedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({
        valid: false,
        error: {
          code: 'verify_failed',
          message: err instanceof Error ? err.message : 'Verification failed',
        },
      });
    }
  });

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'exora-vc-verify' });
  });

  return router;
}
