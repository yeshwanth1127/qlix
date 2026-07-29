import crypto from 'node:crypto';

const SERVICE_SECRET = process.env.SERVICE_SECRET || '';

/** Constant-time string compare to avoid leaking the secret via response timing. */
export function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Pull the shared secret from either `X-Service-Secret` or `Authorization: Bearer <secret>`. */
export function extractServiceSecret(req) {
  const header = req.header('X-Service-Secret');
  if (header && header.trim()) return header.trim();
  const auth = req.header('authorization') || req.header('Authorization');
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return '';
}

/**
 * Express middleware enforcing the internal service secret. Fails closed (503) if the service was
 * started without SERVICE_SECRET configured, so an unconfigured deployment can never be wide open.
 */
export function requireServiceSecret(req, res, next) {
  if (!SERVICE_SECRET) {
    res.status(503).json({ ok: false, error: 'Service secret not configured' });
    return;
  }
  const provided = extractServiceSecret(req);
  if (!provided || !timingSafeEqualStr(provided, SERVICE_SECRET)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  next();
}
