import type { NextFunction, Request, Response } from 'express';
import { AUTH_COOKIE_NAME, verifyAuthToken } from '../lib/authTokens.js';
import { prisma } from '../lib/prisma.js';

export function loadJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  // HS256 keys must be long/high-entropy; 16 chars is brute-forceable offline. Require >= 32.
  const minLen = process.env.NODE_ENV === 'production' ? 32 : 16;
  if (!secret || secret.length < minLen) {
    throw new Error(`JWT_SECRET must be set (min ${minLen} characters)`);
  }
  return secret;
}

function extractBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

function extractSessionToken(request: Request): string | undefined {
  const cookie = request.cookies?.[AUTH_COOKIE_NAME] as string | undefined;
  if (cookie) return cookie;
  return extractBearerToken(request.headers.authorization);
}

/**
 * Requires a valid session cookie or Bearer JWT; attaches `req.auth`. Returns 401 when missing or invalid.
 */
export function authenticateUser(required: boolean) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const secret = loadJwtSecret();
      const raw = extractSessionToken(request);
      if (!raw) {
        if (required) {
          response.status(401).json({ error: { code: 'unauthorized', message: 'Not signed in' } });
          return;
        }
        next();
        return;
      }
      const payload = verifyAuthToken(raw, secret);

      // Re-check the account on every request so deactivation and role changes take effect
      // immediately, instead of being trusted from the JWT for up to the 7-day session lifetime.
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isActive: true, role: true, orgId: true },
      });
      if (!user || !user.isActive) {
        if (required) {
          response.status(401).json({ error: { code: 'unauthorized', message: 'Account is inactive' } });
          return;
        }
        next();
        return;
      }

      request.auth = {
        userId: payload.sub,
        orgId: user.orgId ?? payload.orgId,
        email: payload.email,
        role: user.role,
      };
      next();
    } catch {
      if (required) {
        response.status(401).json({ error: { code: 'unauthorized', message: 'Invalid or expired session' } });
        return;
      }
      next();
    }
  };
}
