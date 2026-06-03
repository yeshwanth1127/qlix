import jwt from 'jsonwebtoken';

export const AUTH_COOKIE_NAME = 'qlix_session';

export interface AuthTokenPayload {
  readonly sub: string;
  readonly orgId: string;
  readonly email: string;
  readonly role: string;
}

export function signAuthToken(
  payload: AuthTokenPayload,
  secret: string,
  expiresInSeconds: number,
): string {
  return jwt.sign(
    {
      sub: payload.sub,
      orgId: payload.orgId,
      email: payload.email,
      role: payload.role,
    },
    secret,
    { expiresIn: expiresInSeconds, issuer: 'qlix-backend', algorithm: 'HS256' },
  );
}

export function verifyAuthToken(token: string, secret: string): AuthTokenPayload {
  const decoded = jwt.verify(token, secret, { issuer: 'qlix-backend', algorithms: ['HS256'] });
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid token payload');
  }
  const record = decoded as Record<string, unknown>;
  const sub = record.sub;
  const orgId = record.orgId;
  const email = record.email;
  const role = record.role;
  if (typeof sub !== 'string' || typeof orgId !== 'string' || typeof email !== 'string' || typeof role !== 'string') {
    throw new Error('Invalid token claims');
  }
  return { sub, orgId, email, role };
}

/** Short-lived proof of WebAuthn user verification before sensitive actions (e.g. agent creation). */
export const AGENT_CREATE_STEP_UP_TTL_SEC = 300;

export function mintAgentCreateStepUpToken(userId: string, secret: string): string {
  return jwt.sign(
    { sub: userId, qlixStepUp: 'agent_create' },
    secret,
    {
      expiresIn: AGENT_CREATE_STEP_UP_TTL_SEC,
      issuer: 'qlix-backend',
      algorithm: 'HS256',
    },
  );
}

export function verifyAgentCreateStepUpToken(token: string, secret: string, expectedUserId: string): void {
  const decoded = jwt.verify(token, secret, { issuer: 'qlix-backend', algorithms: ['HS256'] });
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid step-up token');
  }
  const record = decoded as Record<string, unknown>;
  if (record.qlixStepUp !== 'agent_create') {
    throw new Error('Invalid step-up scope');
  }
  if (record.sub !== expectedUserId) {
    throw new Error('Step-up token subject mismatch');
  }
}
