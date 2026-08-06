import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  ALL_API_KEY_SCOPES,
  apiKeyHasScopes,
  isApiKeyCredential,
  resolveApiKeyRouteAccess,
} from '../lib/apiKeyScopes.js';
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

function extractApiKeyHeader(request: Request): string | undefined {
  const header = request.headers['x-api-key'];
  if (typeof header === 'string' && header.trim().length > 0) return header.trim();
  if (Array.isArray(header) && header[0]?.trim()) return header[0].trim();
  return undefined;
}

function extractCredential(request: Request): string | undefined {
  // Prefer explicit API key headers so scripts win over an incidental browser cookie.
  const apiKeyHeader = extractApiKeyHeader(request);
  if (apiKeyHeader) return apiKeyHeader;
  const bearer = extractBearerToken(request.headers.authorization);
  if (bearer) return bearer;
  const cookie = request.cookies?.[AUTH_COOKIE_NAME] as string | undefined;
  return cookie;
}

function unauthorized(response: Response, message: string): void {
  response.status(401).json({ error: { code: 'unauthorized', message } });
}

function forbidden(response: Response, message: string, code = 'forbidden'): void {
  response.status(403).json({ error: { code, message } });
}

function hashApiKey(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function touchLastUsedAt(apiKeyId: string): void {
  void prisma.apiKey
    .update({ where: { id: apiKeyId }, data: { lastUsedAt: new Date() } })
    .catch((err) => {
      console.error('[authenticateUser] failed to bump api key lastUsedAt', err);
    });
}

async function authenticateWithApiKey(
  request: Request,
  response: Response,
  rawKey: string,
  required: boolean,
  next: NextFunction,
): Promise<void> {
  const keyHash = hashApiKey(rawKey);
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      userId: true,
      orgId: true,
      keyPrefix: true,
      scopes: true,
      revokedAt: true,
    },
  });

  if (!apiKey || apiKey.revokedAt) {
    if (required) {
      unauthorized(response, 'Invalid or revoked API key');
      return;
    }
    next();
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: apiKey.userId },
    select: { isActive: true, role: true, orgId: true, email: true },
  });
  if (!user || !user.isActive) {
    if (required) {
      unauthorized(response, 'Account is inactive');
      return;
    }
    next();
    return;
  }

  const pathForMatch = request.originalUrl || request.url || '';
  const access = resolveApiKeyRouteAccess(request.method, pathForMatch);
  if (!access.allowed) {
    if (required) {
      forbidden(
        response,
        'This endpoint is not available with API keys. Use a session token or see the Developer API docs.',
        'api_key_not_allowed',
      );
      return;
    }
    next();
    return;
  }

  // Legacy keys with empty scopes array are treated as full grant.
  const grantedScopes = apiKey.scopes.length > 0 ? apiKey.scopes : [...ALL_API_KEY_SCOPES];
  if (!apiKeyHasScopes(grantedScopes, access.scopes)) {
    if (required) {
      forbidden(
        response,
        `API key missing required scope: ${access.scopes.join(', ')}`,
        'insufficient_scope',
      );
      return;
    }
    next();
    return;
  }

  request.auth = {
    userId: apiKey.userId,
    orgId: apiKey.orgId || user.orgId || '',
    email: user.email,
    role: user.role,
    authMethod: 'api_key',
    apiKeyId: apiKey.id,
    apiKeyPrefix: apiKey.keyPrefix,
    apiKeyScopes: grantedScopes,
  };
  touchLastUsedAt(apiKey.id);
  next();
}

/**
 * Requires a valid session cookie, Bearer JWT, or `qlix_live_*` API key (Bearer or X-Api-Key).
 * Attaches `req.auth`. Returns 401 when missing or invalid.
 *
 * API keys are restricted to the curated Developer API surface and must hold the
 * scopes required for the matched route. Session JWT bypasses scope checks.
 */
export function authenticateUser(required: boolean) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = extractCredential(request);
      if (!raw) {
        if (required) {
          unauthorized(response, 'Not signed in');
          return;
        }
        next();
        return;
      }

      if (isApiKeyCredential(raw)) {
        await authenticateWithApiKey(request, response, raw, required, next);
        return;
      }

      const secret = loadJwtSecret();
      const payload = verifyAuthToken(raw, secret);

      // Re-check the account on every request so deactivation and role changes take effect
      // immediately, instead of being trusted from the JWT for up to the 7-day session lifetime.
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isActive: true, role: true, orgId: true },
      });
      if (!user || !user.isActive) {
        if (required) {
          unauthorized(response, 'Account is inactive');
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
        authMethod: 'session',
      };
      next();
    } catch {
      if (required) {
        unauthorized(response, 'Invalid or expired session');
        return;
      }
      next();
    }
  };
}

/**
 * Like `authenticateUser`, but rejects API-key auth. Use for sensitive console-only
 * surfaces such as API key CRUD (prevents key→mint more keys).
 */
export function authenticateSessionOnly(required: boolean) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const apiKeyHeader = extractApiKeyHeader(request);
    const bearer = extractBearerToken(request.headers.authorization);
    if ((apiKeyHeader && isApiKeyCredential(apiKeyHeader)) || (bearer && isApiKeyCredential(bearer))) {
      if (required) {
        forbidden(response, 'API keys cannot manage API keys. Sign in with a session.', 'session_required');
        return;
      }
      next();
      return;
    }
    return authenticateUser(required)(request, response, next);
  };
}
