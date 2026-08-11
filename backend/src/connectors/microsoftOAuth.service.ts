import jwt from 'jsonwebtoken';
import { loadJwtSecret } from '../middleware/authenticateUser.js';
import type { StoredOAuthTokens } from './connectors.types.js';

/**
 * Microsoft identity platform (Entra ID) OAuth for Microsoft Graph connectors.
 * Register a Web app in Entra → App registrations and add MICROSOFT_OAUTH_REDIRECT_URI
 * as a Redirect URI under Authentication.
 */
const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';

/** Delegated Graph scopes — identity + Outlook mail/calendar + OneDrive + contacts/tasks. */
export const MICROSOFT_GRAPH_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.ReadWrite',
  'Files.ReadWrite.All',
  'Contacts.ReadWrite',
  'Tasks.ReadWrite',
] as const;

export class MicrosoftOAuthNotConfiguredError extends Error {
  readonly code = 'microsoft_oauth_not_configured';
}

function microsoftTenant(): string {
  return process.env.MICROSOFT_OAUTH_TENANT?.trim() || 'common';
}

function microsoftAuthBase(): string {
  return `https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0`;
}

function microsoftClientConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.MICROSOFT_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new MicrosoftOAuthNotConfiguredError(
      'Set MICROSOFT_OAUTH_CLIENT_ID, MICROSOFT_OAUTH_CLIENT_SECRET, and MICROSOFT_OAUTH_REDIRECT_URI',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function mintMicrosoftOAuthState(userId: string, orgId: string): string {
  const secret = loadJwtSecret();
  return jwt.sign({ sub: userId, orgId, qlixOAuth: 'microsoft_connector' }, secret, {
    expiresIn: 600,
    issuer: 'qlix-backend',
    algorithm: 'HS256',
  });
}

export function verifyMicrosoftOAuthState(state: string): { userId: string; orgId: string } {
  const secret = loadJwtSecret();
  const decoded = jwt.verify(state, secret, { issuer: 'qlix-backend', algorithms: ['HS256'] });
  if (typeof decoded !== 'object' || decoded === null) throw new Error('Invalid OAuth state');
  const record = decoded as Record<string, unknown>;
  if (record.qlixOAuth !== 'microsoft_connector') throw new Error('Invalid OAuth state purpose');
  if (typeof record.sub !== 'string' || typeof record.orgId !== 'string') {
    throw new Error('Invalid OAuth state claims');
  }
  return { userId: record.sub, orgId: record.orgId };
}

export function buildMicrosoftAuthUrl(state: string): string {
  const { clientId, redirectUri } = microsoftClientConfig();
  // Entra v2 accepts a single prompt value only (login | none | consent | select_account).
  // Combining values (e.g. "select_account consent") yields AADSTS90023.
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: MICROSOFT_GRAPH_SCOPES.join(' '),
    state,
    prompt: 'select_account',
  });
  return `${microsoftAuthBase()}/authorize?${params.toString()}`;
}

async function microsoftFormPost(
  url: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const text = await resp.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!resp.ok) {
    const errMsg =
      typeof parsed.error_description === 'string'
        ? parsed.error_description
        : typeof parsed.error === 'string'
          ? parsed.error
          : text.slice(0, 400);
    throw new Error(`Microsoft OAuth HTTP ${resp.status}: ${errMsg}`);
  }
  return parsed;
}

async function fetchMicrosoftUserLabel(accessToken: string): Promise<string | null> {
  try {
    const resp = await fetch(GRAPH_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return null;
    const me = (await resp.json()) as {
      displayName?: string;
      mail?: string | null;
      userPrincipalName?: string;
    };
    const email =
      (typeof me.mail === 'string' && me.mail.trim()) ||
      (typeof me.userPrincipalName === 'string' ? me.userPrincipalName : null);
    const name = typeof me.displayName === 'string' ? me.displayName.trim() : '';
    if (name && email) return `${name} · ${email}`;
    if (email) return email;
    return name || null;
  } catch {
    return null;
  }
}

export async function exchangeMicrosoftCode(code: string): Promise<StoredOAuthTokens> {
  const { clientId, clientSecret, redirectUri } = microsoftClientConfig();
  const tokenResp = await microsoftFormPost(`${microsoftAuthBase()}/token`, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    scope: MICROSOFT_GRAPH_SCOPES.join(' '),
  });

  const accessToken = String(tokenResp.access_token ?? '');
  if (!accessToken) throw new Error('Microsoft OAuth did not return an access token');

  const refreshToken = String(tokenResp.refresh_token ?? '');
  const expiresIn = Number(tokenResp.expires_in ?? 0);
  const scopeRaw = String(tokenResp.scope ?? '');
  const scopes = scopeRaw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const emailAddress = await fetchMicrosoftUserLabel(accessToken);

  return {
    accessToken,
    refreshToken,
    expiresAtMs: expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
    scopes: scopes.length > 0 ? scopes : [...MICROSOFT_GRAPH_SCOPES],
    emailAddress,
  };
}

export async function refreshMicrosoftToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number | null;
  scopes: string[];
}> {
  const { clientId, clientSecret } = microsoftClientConfig();
  const tokenResp = await microsoftFormPost(`${microsoftAuthBase()}/token`, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: MICROSOFT_GRAPH_SCOPES.join(' '),
  });
  const accessToken = String(tokenResp.access_token ?? '');
  if (!accessToken) throw new Error('Microsoft refresh did not return access_token');
  const nextRefresh = String(tokenResp.refresh_token ?? refreshToken);
  const expiresIn = Number(tokenResp.expires_in ?? 0);
  const scopeRaw = String(tokenResp.scope ?? '');
  const scopes = scopeRaw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    accessToken,
    refreshToken: nextRefresh,
    expiresAtMs: expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
    scopes,
  };
}

/**
 * Best-effort: Entra has no simple per-token revoke for confidential clients.
 * Local disconnect always proceeds even if this no-ops.
 */
export async function revokeMicrosoftToken(_token: string): Promise<void> {
  // No reliable single-token revoke for delegated Graph tokens; callers delete locally.
}
