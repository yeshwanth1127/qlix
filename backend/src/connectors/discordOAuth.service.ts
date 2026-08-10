import jwt from 'jsonwebtoken';
import { loadJwtSecret } from '../middleware/authenticateUser.js';
import type { StoredOAuthTokens } from './connectors.types.js';

const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_REVOKE_URL = 'https://discord.com/api/oauth2/token/revoke';
const DISCORD_API = 'https://discord.com/api/v10';

/** User OAuth scopes — identity + servers the user can see. */
export const DISCORD_USER_SCOPES = ['identify', 'email', 'guilds'] as const;

export class DiscordOAuthNotConfiguredError extends Error {
  readonly code = 'discord_oauth_not_configured';
}

function discordClientConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.DISCORD_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new DiscordOAuthNotConfiguredError(
      'Set DISCORD_OAUTH_CLIENT_ID, DISCORD_OAUTH_CLIENT_SECRET, and DISCORD_OAUTH_REDIRECT_URI',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function mintDiscordOAuthState(userId: string, orgId: string): string {
  const secret = loadJwtSecret();
  return jwt.sign({ sub: userId, orgId, qlixOAuth: 'discord_connector' }, secret, {
    expiresIn: 600,
    issuer: 'qlix-backend',
    algorithm: 'HS256',
  });
}

export function verifyDiscordOAuthState(state: string): { userId: string; orgId: string } {
  const secret = loadJwtSecret();
  const decoded = jwt.verify(state, secret, { issuer: 'qlix-backend', algorithms: ['HS256'] });
  if (typeof decoded !== 'object' || decoded === null) throw new Error('Invalid OAuth state');
  const record = decoded as Record<string, unknown>;
  if (record.qlixOAuth !== 'discord_connector') throw new Error('Invalid OAuth state purpose');
  if (typeof record.sub !== 'string' || typeof record.orgId !== 'string') {
    throw new Error('Invalid OAuth state claims');
  }
  return { userId: record.sub, orgId: record.orgId };
}

export function buildDiscordAuthUrl(state: string): string {
  const { clientId, redirectUri } = discordClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DISCORD_USER_SCOPES.join(' '),
    state,
    prompt: 'consent',
  });
  return `${DISCORD_AUTH_URL}?${params.toString()}`;
}

async function discordFormPost(
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
    throw new Error(`Discord OAuth HTTP ${resp.status}: ${errMsg}`);
  }
  return parsed;
}

async function fetchDiscordUserLabel(accessToken: string): Promise<string | null> {
  try {
    const resp = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return null;
    const user = (await resp.json()) as {
      username?: string;
      global_name?: string | null;
      email?: string | null;
      discriminator?: string;
    };
    const name =
      (typeof user.global_name === 'string' && user.global_name.trim()) ||
      (typeof user.username === 'string' ? user.username : null);
    if (name && user.email) return `${name} · ${user.email}`;
    if (name) return name;
    return typeof user.email === 'string' ? user.email : null;
  } catch {
    return null;
  }
}

export async function exchangeDiscordCode(code: string): Promise<StoredOAuthTokens> {
  const { clientId, clientSecret, redirectUri } = discordClientConfig();
  const tokenResp = await discordFormPost(DISCORD_TOKEN_URL, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const accessToken = String(tokenResp.access_token ?? '');
  if (!accessToken) throw new Error('Discord OAuth did not return an access token');

  const refreshToken = String(tokenResp.refresh_token ?? '');
  const expiresIn = Number(tokenResp.expires_in ?? 0);
  const scopeRaw = String(tokenResp.scope ?? '');
  const scopes = scopeRaw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const emailAddress = await fetchDiscordUserLabel(accessToken);

  return {
    accessToken,
    refreshToken,
    expiresAtMs: expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
    scopes,
    emailAddress,
  };
}

export async function refreshDiscordToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number | null;
}> {
  const { clientId, clientSecret } = discordClientConfig();
  const tokenResp = await discordFormPost(DISCORD_TOKEN_URL, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const accessToken = String(tokenResp.access_token ?? '');
  if (!accessToken) throw new Error('Discord refresh did not return access_token');
  const nextRefresh = String(tokenResp.refresh_token ?? refreshToken);
  const expiresIn = Number(tokenResp.expires_in ?? 0);
  return {
    accessToken,
    refreshToken: nextRefresh,
    expiresAtMs: expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
  };
}

/** Best-effort revoke at Discord. */
export async function revokeDiscordToken(token: string): Promise<void> {
  if (!token) return;
  try {
    const { clientId, clientSecret } = discordClientConfig();
    await discordFormPost(DISCORD_REVOKE_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      token,
    });
  } catch {
    // Local disconnect proceeds even if revoke fails.
  }
}
