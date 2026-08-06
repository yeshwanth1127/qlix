import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ALL_API_KEY_SCOPES,
  API_KEY_PREFIX,
  API_KEY_SCOPES,
  normalizeApiKeyScopes,
} from '../lib/apiKeyScopes.js';
import { prisma } from '../lib/prisma.js';
import { authenticateSessionOnly } from '../middleware/authenticateUser.js';

/**
 * User-issued API keys for programmatic access to the Qlix Developer API.
 * Only a sha256 hash of the key is stored — the raw key is returned once at creation.
 * Key CRUD requires a browser/session JWT (API keys cannot mint or revoke keys).
 */

function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const secret = crypto.randomBytes(24).toString('base64url');
  const raw = `${API_KEY_PREFIX}${secret}`;
  const prefix = raw.slice(0, API_KEY_PREFIX.length + 6);
  const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  return { raw, prefix, hash };
}

const createSchema = z.object({
  label: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(API_KEY_SCOPES)).optional(),
});

function canManageOrgKeys(role: string): boolean {
  const r = role.toLowerCase();
  return r === 'owner' || r === 'admin';
}

export function createApiKeysRouter(): Router {
  const router = Router();

  router.get('/', authenticateSessionOnly(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const isAdmin = canManageOrgKeys(auth.role);
      const keys = await prisma.apiKey.findMany({
        where: isAdmin ? { orgId: auth.orgId } : { orgId: auth.orgId, userId: auth.userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          label: true,
          keyPrefix: true,
          scopes: true,
          createdAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      });
      response.json({
        keys: keys.map((k) => ({
          id: k.id,
          label: k.label,
          keyPrefix: k.keyPrefix,
          scopes: k.scopes.length > 0 ? k.scopes : [...ALL_API_KEY_SCOPES],
          createdAt: k.createdAt.toISOString(),
          lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
          revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
        })),
        availableScopes: [...ALL_API_KEY_SCOPES],
        canManage: isAdmin,
      });
    } catch (err) {
      console.error('api-keys list error', err);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load API keys' } });
    }
  });

  router.post('/', authenticateSessionOnly(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      if (!canManageOrgKeys(auth.role)) {
        response.status(403).json({
          error: { code: 'forbidden', message: 'Only owners and admins can create API keys' },
        });
        return;
      }
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: { code: 'invalid_body', message: 'label is required; scopes must be valid API key scopes' },
        });
        return;
      }
      const scopes = normalizeApiKeyScopes(parsed.data.scopes ?? [...ALL_API_KEY_SCOPES]);
      const { raw, prefix, hash } = generateApiKey();
      const created = await prisma.apiKey.create({
        data: {
          userId: auth.userId,
          orgId: auth.orgId,
          label: parsed.data.label,
          keyPrefix: prefix,
          keyHash: hash,
          scopes,
        },
      });
      // `key` is only ever present in this one response — it is never retrievable again.
      response.json({
        id: created.id,
        label: created.label,
        key: raw,
        keyPrefix: created.keyPrefix,
        scopes: created.scopes,
        createdAt: created.createdAt.toISOString(),
      });
    } catch (err) {
      console.error('api-keys create error', err);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to create API key' } });
    }
  });

  router.delete('/:id', authenticateSessionOnly(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      if (!canManageOrgKeys(auth.role)) {
        response.status(403).json({
          error: { code: 'forbidden', message: 'Only owners and admins can revoke API keys' },
        });
        return;
      }
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
