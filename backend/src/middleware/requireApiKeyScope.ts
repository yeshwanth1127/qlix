import type { NextFunction, Request, Response } from 'express';
import { apiKeyHasScopes, type ApiKeyScope } from '../lib/apiKeyScopes.js';

/**
 * Explicit scope gate for routes that need an additional check beyond the
 * path-based Developer API allowlist in `authenticateUser`.
 * Session JWT always passes. API keys must hold every listed scope.
 */
export function requireApiKeyScope(...required: ApiKeyScope[]) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const auth = request.auth;
    if (!auth || auth.authMethod !== 'api_key') {
      next();
      return;
    }
    if (!apiKeyHasScopes(auth.apiKeyScopes, required)) {
      response.status(403).json({
        error: {
          code: 'insufficient_scope',
          message: `API key missing required scope: ${required.join(', ')}`,
        },
      });
      return;
    }
    next();
  };
}
