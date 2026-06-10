import type { NextFunction, Request, Response } from 'express';
import { AUTH_COOKIE_NAME, verifyAuthToken } from '../lib/authTokens.js';

export function loadJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET must be set (min 16 characters)');
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
  return (request: Request, response: Response, next: NextFunction): void => {
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
      request.auth = {
        userId: payload.sub,
        orgId: payload.orgId,
        email: payload.email,
        role: payload.role,
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
