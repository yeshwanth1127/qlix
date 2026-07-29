import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateUser } from '../middleware/authenticateUser.js';

/**
 * User-issued API keys for programmatic access to the Qlix API. Only a sha256 hash of the
 * key is ever stored — the raw key is returned once, at creation time, and never again.
 * NOTE: requires the `ApiKey` table (see `prisma/schema.prisma`) — apply that migration
 * before this router is live.
 */

const KEY_PREFIX = 'qlix_live_';

function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const secret = crypto.randomBytes(24).toString('base64url');
  const raw = `${KEY_PREFIX}${secret}`;
  const prefix = raw.slice(0, KEY_PREFIX.length + 6);
  const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  return { raw, prefix, hash };
}

const createSchema = z.object({
  label: z.string().trim().min(1).max(120),
});

export function createApiKeysRouter(): Router {
  const router = Router();

  router.get('/', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const keys = await prisma.apiKey.findMany({
        where: { orgId: auth.orgId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, label: true, keyPrefix: true, createdAt: true, lastUsedAt: true, revokedAt: true },
      });
      response.json({
        keys: keys.map((k) => ({
          id: k.id,
          label: k.label,
          keyPrefix: k.keyPrefix,
          createdAt: k.createdAt.toISOString(),
          lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
          revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
        })),
      });
    } catch (err) {
      console.error('api-keys list error', err);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load API keys' } });
    }
  });

  router.post('/', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'label is required' } });
        return;
      }
      const { raw, prefix, hash } = generateApiKey();
      const created = await prisma.apiKey.create({
        data: {
          userId: auth.userId,
          orgId: auth.orgId,
          label: parsed.data.label,
          keyPrefix: prefix,
          keyHash: hash,
        },
      });
      // `key` is only ever present in this one response — it is never retrievable again.
      response.json({
        id: created.id,
        label: created.label,
        key: raw,
        keyPrefix: created.keyPrefix,
        createdAt: created.createdAt.toISOString(),
      });
    } catch (err) {
      console.error('api-keys create error', err);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to create API key' } });
    }
  });

  router.delete('/:id', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const id = String(request.params.id);
      const existing = await prisma.apiKey.findUnique({ where: { id } });
      if (!existing || existing.orgId !== auth.orgId) {
        response.status(404).json({ error: { code: 'not_found', message: 'API key not found' } });
        return;
      }
      await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
      response.json({ ok: true });
    } catch (err) {
      console.error('api-keys revoke error', err);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to revoke API key' } });
    }
  });

  return router;
}
