import jwt from 'jsonwebtoken';
import { loadJwtSecret } from '../middleware/authenticateUser.js';
import type { StoredOAuthTokens } from './connectors.types.js';

export const ZOHO_CRM_SCOPES = [
  'ZohoCRM.modules.ALL',
  'ZohoCRM.coql.READ',
  'ZohoCRM.settings.READ',
  'ZohoCRM.settings.fields.READ',
  'ZohoCRM.users.READ',
];

export class ZohoOAuthNotConfiguredError extends Error {
  readonly code = 'zoho_oauth_not_configured';
}

function zohoClientConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.ZOHO_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOHO_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.ZOHO_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new ZohoOAuthNotConfiguredError(
      'Set ZOHO_OAUTH_CLIENT_ID, ZOHO_OAUTH_CLIENT_SECRET, and ZOHO_OAUTH_REDIRECT_URI',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function defaultAccountsUrl(): string {
  const fromEnv = process.env.ZOHO_ACCOUNTS_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'https://accounts.zoho.com';
}

export function resolveZohoAccountsUrl(accountsServer?: string | null): string {
  if (accountsServer?.trim()) return accountsServer.trim().replace(/\/$/, '');
  return defaultAccountsUrl();
}

export function mintZohoOAuthState(userId: string, orgId: string): string {
  const secret = loadJwtSecret();
  return jwt.sign({ sub: userId, orgId, qlixOAuth: 'zoho_connector' }, secret, {
    expiresIn: 600,
    issuer: 'qlix-backend',
    algorithm: 'HS256',
  });
}

export function verifyZohoOAuthState(state: string): { userId: string; orgId: string } {
  const secret = loadJwtSecret();
  const decoded = jwt.verify(state, secret, { issuer: 'qlix-backend', algorithms: ['HS256'] });
  if (typeof decoded !== 'object' || decoded === null) throw new Error('Invalid OAuth state');
  const record = decoded as Record<string, unknown>;
  if (record.qlixOAuth !== 'zoho_connector') throw new Error('Invalid OAuth state purpose');
  if (typeof record.sub !== 'string' || typeof record.orgId !== 'string') throw new Error('Invalid OAuth state claims');
  return { userId: record.sub, orgId: record.orgId };
}

export function buildZohoAuthUrl(state: string): string {
  const { clientId, redirectUri } = zohoClientConfig();
  const accountsUrl = defaultAccountsUrl();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ZOHO_CRM_SCOPES.join(','),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${accountsUrl}/oauth/v2/auth?${params.toString()}`;
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
    throw new Error(`Zoho API error ${resp.status}: ${text.slice(0, 500)}`);
  }
  return body;
}

async function fetchCurrentUserEmail(accessToken: string, apiDomain: string): Promise<string | null> {
  try {
    const base = apiDomain.replace(/\/$/, '');
    const resp = await fetch(`${base}/crm/v8/users?type=CurrentUser`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const text = await resp.text();
    if (!resp.ok) return null;
    const parsed = JSON.parse(text) as { users?: Array<{ email?: string; full_name?: string }> };
    const user = parsed.users?.[0];
    return user?.email ?? user?.full_name ?? null;
  } catch {
    return null;
  }
}

export async function exchangeZohoCode(
  code: string,
  accountsServer?: string | null,
): Promise<StoredOAuthTokens> {
  const { clientId, clientSecret, redirectUri } = zohoClientConfig();
  const accountsUrl = resolveZohoAccountsUrl(accountsServer);
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const tokenResp = await fetchJson(`${accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const accessToken = String(tokenResp.access_token ?? '');
  const refreshToken = String(tokenResp.refresh_token ?? '');
  if (!accessToken || !refreshToken) {
    throw new Error('Zoho token exchange did not return access/refresh tokens');
  }
  const expiresIn = Number(tokenResp.expires_in ?? 3600);
  const expiresAtMs = Date.now() + expiresIn * 1000;
  const scopeRaw = String(tokenResp.scope ?? '');
  const scopes = scopeRaw.split(/[, \s]+/).filter(Boolean);
  const apiDomain = typeof tokenResp.api_domain === 'string' ? tokenResp.api_domain : null;

  let emailAddress: string | null = null;
  if (apiDomain) {
    emailAddress = await fetchCurrentUserEmail(accessToken, apiDomain);
  }

  return {
    accessToken,
    refreshToken,
    expiresAtMs,
    scopes,
    emailAddress,
    apiDomain,
    accountsUrl,
  };
}

export async function refreshZohoAccessToken(tokens: StoredOAuthTokens): Promise<{
  accessToken: string;
  expiresAtMs: number;
}> {
  const { clientId, clientSecret } = zohoClientConfig();
  const accountsUrl = resolveZohoAccountsUrl(tokens.accountsUrl);
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token',
  });
  const tokenResp = await fetchJson(`${accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const accessToken = String(tokenResp.access_token ?? '');
  if (!accessToken) throw new Error('Zoho refresh did not return access_token');
  const expiresIn = Number(tokenResp.expires_in ?? 3600);
  return { accessToken, expiresAtMs: Date.now() + expiresIn * 1000 };
}

/** Best-effort revocation at Zoho. */
export async function revokeZohoToken(token: string, accountsUrl?: string | null): Promise<void> {
  if (!token) return;
  const base = resolveZohoAccountsUrl(accountsUrl);
  try {
    await fetch(`${base}/oauth/v2/token/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // Best-effort: local disconnect proceeds even if revoke fails.
  }
}
