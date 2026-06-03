import type { NextFunction, Request, Response } from 'express';
import { AUTH_COOKIE_NAME, verifyAuthToken } from '../lib/authTokens.js';

export function loadJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET must be set (min 16 characters)');
  }
  return secret;
}

/**
 * Requires a valid session cookie; attaches `req.auth`. Returns 401 when missing or invalid.
 */
export function authenticateUser(required: boolean) {
  return (request: Request, response: Response, next: NextFunction): void => {
    try {
      const secret = loadJwtSecret();
      const raw = request.cookies?.[AUTH_COOKIE_NAME] as string | undefined;
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
