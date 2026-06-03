import crypto from 'node:crypto';
import type { Request } from 'express';

function normalizeToken(raw: string): string {
  return raw.trim();
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function getConfiguredTokenHashes(): string[] {
  const raw = process.env.BILLING_INGEST_SERVICE_TOKEN_HASHES ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function getServiceTokenFromRequest(request: Request): string | null {
  const header = request.header('x-service-token');
  if (header && header.trim()) return normalizeToken(header);

  const auth = request.header('authorization');
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1]?.trim();
  return token ? normalizeToken(token) : null;
}

export function verifyServiceToken(rawToken: string): boolean {
  const hashes = getConfiguredTokenHashes();
  if (hashes.length === 0) return false;
  const computed = sha256Hex(normalizeToken(rawToken)).toLowerCase();
  return hashes.some((h) => constantTimeEquals(h, computed));
}

