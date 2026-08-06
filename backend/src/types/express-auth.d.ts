import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: {
      userId: string;
      orgId: string;
      email: string;
      role: string;
      /** How the request was authenticated. Defaults to session when omitted by older paths. */
      authMethod?: 'session' | 'api_key';
      /** Present when authMethod is api_key. */
      apiKeyId?: string;
      /** Present when authMethod is api_key — key prefix for audit display. */
      apiKeyPrefix?: string;
      /** Scopes granted to the API key. */
      apiKeyScopes?: string[];
    };
  }
}

export {};
