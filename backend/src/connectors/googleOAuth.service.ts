import jwt from 'jsonwebtoken';
import { loadJwtSecret } from '../middleware/authenticateUser.js';
import { encryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import type { StoredOAuthTokens } from './connectors.types.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

export const GOOGLE_EMAIL_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

export class GoogleOAuthNotConfiguredError extends Error {
  readonly code = 'google_oauth_not_configured';
}

function googleClientConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GoogleOAuthNotConfiguredError(
      'Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function mintGoogleOAuthState(userId: string, orgId: string): string {
  const secret = loadJwtSecret();
  return jwt.sign({ sub: userId, orgId, qlixOAuth: 'google_connector' }, secret, {
    expiresIn: 600,
    issuer: 'qlix-backend',
    algorithm: 'HS256',
  });
}

export function verifyGoogleOAuthState(state: string): { userId: string; orgId: string } {
  const secret = loadJwtSecret();
  const decoded = jwt.verify(state, secret, { issuer: 'qlix-backend', algorithms: ['HS256'] });
  if (typeof decoded !== 'object' || decoded === null) throw new Error('Invalid OAuth state');
  const record = decoded as Record<string, unknown>;
  if (record.qlixOAuth !== 'google_connector') throw new Error('Invalid OAuth state purpose');
  if (typeof record.sub !== 'string' || typeof record.orgId !== 'string') throw new Error('Invalid OAuth state claims');
  return { userId: record.sub, orgId: record.orgId };
}

export function buildGoogleAuthUrl(state: string): string {
  const { clientId, redirectUri } = googleClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_EMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const resp = await fetch(url, init);
  const text = await resp.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  if (!resp.ok) {
    throw new Error(`Google API error ${resp.status}: ${text.slice(0, 500)}`);
  }
  return body;
}

export async function exchangeGoogleCode(code: string): Promise<StoredOAuthTokens> {
  const { clientId, clientSecret, redirectUri } = googleClientConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const tokenResp = await fetchJson(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const accessToken = String(tokenResp.access_token ?? '');
  const refreshToken = String(tokenResp.refresh_token ?? '');
  if (!accessToken || !refreshToken) {
    throw new Error('Google token exchange did not return access/refresh tokens');
  }
  const expiresIn = Number(tokenResp.expires_in ?? 3600);
  const expiresAtMs = Date.now() + expiresIn * 1000;
  const scopeRaw = String(tokenResp.scope ?? '');
  const scopes = scopeRaw.split(/\s+/).filter(Boolean);

  let emailAddress: string | null = null;
  try {
    const info = await fetchJson(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    emailAddress = typeof info.email === 'string' ? info.email : null;
  } catch {
    emailAddress = null;
  }

  return { accessToken, refreshToken, expiresAtMs, scopes, emailAddress };
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAtMs: number;
}> {
  const { clientId, clientSecret } = googleClientConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const tokenResp = await fetchJson(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const accessToken = String(tokenResp.access_token ?? '');
  if (!accessToken) throw new Error('Google refresh did not return access_token');
  const expiresIn = Number(tokenResp.expires_in ?? 3600);
  return { accessToken, expiresAtMs: Date.now() + expiresIn * 1000 };
}

const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** Best-effort revocation of a Google access/refresh token at Google's endpoint. */
export async function revokeGoogleToken(token: string): Promise<void> {
  if (!token) return;
  try {
    await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // Best-effort: local disconnect proceeds even if Google revoke fails.
  }
}

/** Encrypt helper exposed for n8n secret storage from router. */
export function encryptIntegrationSecret(plaintext: string): string {
  return encryptForAgentSecrets(plaintext);
}
