import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

function timingSafeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function assertInternalServiceSecret(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const expected = process.env.QLIX_INTERNAL_SERVICE_SECRET?.trim();
  if (!expected) {
    response.status(503).json({
      error: { code: 'service_auth_unconfigured', message: 'Internal service secret not configured' },
    });
    return;
  }
  const provided = request.header('x-service-secret')?.trim();
  if (!provided || !timingSafeEquals(provided, expected)) {
    response.status(401).json({ error: { code: 'unauthorized', message: 'Invalid service secret' } });
    return;
  }
  next();
}
