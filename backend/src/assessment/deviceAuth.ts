import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';

/**
 * Auth for the VS Code extension's device grant — mirrors runnerAuth.ts's
 * hybrid-runner-token discipline exactly (random 64-hex token, store only its
 * HMAC hash, timing-safe compare), extended with the two things a runner
 * token doesn't need: workspace-folder binding and expiry.
 */

export const DEVICE_TOKEN_HEADER = 'x-qlix-device-token';

export class DeviceUnauthorizedError extends Error {
  constructor(message = 'Device unauthorized') {
    super(message);
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function computeDeviceTokenHash(token: string): string {
  const key = process.env.AGENT_SECRETS_KEY?.trim();
  if (!key) {
    throw new Error('AGENT_SECRETS_KEY is required to authenticate device grants');
  }
  return crypto.createHmac('sha256', key).update(token).digest('hex');
}

export function extractDeviceToken(request: { headers: Record<string, unknown> }): string {
  const raw = request.headers[DEVICE_TOKEN_HEADER] ?? request.headers[DEVICE_TOKEN_HEADER.toLowerCase()];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  const auth = request.headers.authorization ?? request.headers.Authorization;
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

/** Mint a random device token + its hash. Store only the hash; return the token once. */
export function generateDeviceToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = computeDeviceTokenHash(token);
  return { token, hash };
}

export interface AuthorizedDeviceGrant {
  id: string;
  orgId: string;
  sessionId: string;
  workspaceRoot: string;
  allowedActions: string[];
}

/**
 * Validates the device token and (if provided) that the extension's currently
 * opened folder still matches the workspace this grant is bound to — a device
 * grant issued for one folder can never be replayed against another.
 */
export async function assertDeviceGrantAuth(
  request: { headers: Record<string, unknown> },
  opts?: { workspaceRoot?: string; requireAction?: string },
): Promise<AuthorizedDeviceGrant> {
  const token = extractDeviceToken(request);
  if (!token) throw new DeviceUnauthorizedError('Missing device token');

  const hash = computeDeviceTokenHash(token);
  const grant = await prisma.deviceGrant.findUnique({ where: { tokenHash: hash } });
  if (!grant) throw new DeviceUnauthorizedError('Unknown device token');
  if (grant.revokedAt) throw new DeviceUnauthorizedError('Device grant revoked');
  if (grant.expiresAt.getTime() <= Date.now()) throw new DeviceUnauthorizedError('Device grant expired');
  if (!timingSafeEqualStr(hash, grant.tokenHash)) throw new DeviceUnauthorizedError('Device token mismatch');
  if (opts?.workspaceRoot && opts.workspaceRoot !== grant.workspaceRoot) {
    throw new DeviceUnauthorizedError('Device token is bound to a different workspace folder');
  }
  if (opts?.requireAction && !grant.allowedActions.includes(opts.requireAction)) {
    throw new DeviceUnauthorizedError(`Device grant does not permit ${opts.requireAction}`);
  }

  void prisma.deviceGrant.update({ where: { id: grant.id }, data: { lastSeenAt: new Date() } }).catch(() => {});

  return {
    id: grant.id,
    orgId: grant.orgId,
    sessionId: grant.sessionId,
    workspaceRoot: grant.workspaceRoot,
    allowedActions: grant.allowedActions,
  };
}
