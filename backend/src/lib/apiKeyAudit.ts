import crypto from 'node:crypto';
import type { Request } from 'express';
import { prisma } from './prisma.js';
import { loadJwtSecret } from '../middleware/authenticateUser.js';

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function serverSignature(secret: string, parts: Record<string, unknown>): string {
  return `qlix:hmac:${crypto.createHmac('sha256', secret).update(canonicalJson(parts)).digest('hex')}`;
}

export type ApiKeyAuditAction =
  | 'api_key.agent_scopes_updated'
  | 'api_key.agent_deleted'
  | 'api_key.agents_bulk_deleted'
  | 'api_key.jit_decided';

/**
 * Append a SYSTEM action-log entry when an API key performs a sensitive write.
 * No-op for session auth. Failures are logged and never fail the request.
 */
export function recordApiKeySensitiveUse(
  request: Request,
  action: ApiKeyAuditAction,
  metadata: Record<string, unknown> = {},
): void {
  const auth = request.auth;
  if (!auth || auth.authMethod !== 'api_key' || !auth.apiKeyId) return;

  void (async () => {
    try {
      const secret = loadJwtSecret();
      const timestampMs = BigInt(Date.now());
      const prevHash = '';
      const signaturePayload = {
        kind: 'api_key_sensitive' as const,
        action,
        apiKeyId: auth.apiKeyId,
        apiKeyPrefix: auth.apiKeyPrefix ?? null,
        userId: auth.userId,
        orgId: auth.orgId,
        timestampMs: timestampMs.toString(),
        metadata,
      };
      const signature = serverSignature(secret, signaturePayload);
      await prisma.actionLog.create({
        data: {
          agentId: typeof metadata.agentId === 'string' ? metadata.agentId : null,
          userId: auth.userId,
          actionType: 'SYSTEM',
          payload: {
            actorType: 'admin',
            apiKeyEvent: action,
            apiKeyId: auth.apiKeyId,
            apiKeyPrefix: auth.apiKeyPrefix ?? null,
            ...metadata,
          },
          riskLevel: 'medium',
          status: 'success',
          approvalStatus: 'not_required',
          signature,
          prevHash,
          timestampMs,
        },
      });
    } catch (err) {
      console.error('[api-key-audit] failed to record', err);
    }
  })();
}

/** Stable rate-limit bucket id from a raw API key (never logs the raw secret). */
export function apiKeyRateLimitBucket(rawKey: string): string {
  return `apikey:${sha256Hex(rawKey)}`;
}
