import jwt from 'jsonwebtoken';
import { loadJwtSecret } from '../middleware/authenticateUser.js';
import type { StoredOAuthTokens } from './connectors.types.js';

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API = 'https://api.github.com';

/**
 * User OAuth scopes for the connector — separate from login (`AUTH_GITHUB_*` / read:user user:email).
 * Keep least privilege; expand when agent GitHub tools land.
 */
export const GITHUB_CONNECTOR_SCOPES = ['read:user', 'user:email', 'repo', 'read:org'] as const;

export class GitHubOAuthNotConfiguredError extends Error {
  readonly code = 'github_oauth_not_configured';
}

function githubClientConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GitHubOAuthNotConfiguredError(
      'Set GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, and GITHUB_OAUTH_REDIRECT_URI',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function mintGitHubOAuthState(userId: string, orgId: string): string {
  const secret = loadJwtSecret();
  return jwt.sign({ sub: userId, orgId, qlixOAuth: 'github_connector' }, secret, {
    expiresIn: 600,
    issuer: 'qlix-backend',
    algorithm: 'HS256',
  });
}

export function verifyGitHubOAuthState(state: string): { userId: string; orgId: string } {
  const secret = loadJwtSecret();
  const decoded = jwt.verify(state, secret, { issuer: 'qlix-backend', algorithms: ['HS256'] });
  if (typeof decoded !== 'object' || decoded === null) throw new Error('Invalid OAuth state');
  const record = decoded as Record<string, unknown>;
  if (record.qlixOAuth !== 'github_connector') throw new Error('Invalid OAuth state purpose');
  if (typeof record.sub !== 'string' || typeof record.orgId !== 'string') {
    throw new Error('Invalid OAuth state claims');
  }
  return { userId: record.sub, orgId: record.orgId };
}

export function buildGitHubAuthUrl(state: string): string {
  const { clientId, redirectUri } = githubClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: GITHUB_CONNECTOR_SCOPES.join(' '),
    state,
    allow_signup: 'false',
  });
  return `${GITHUB_AUTH_URL}?${params.toString()}`;
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const resp = await fetch(url, init);
  const text = await resp.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: resp.ok, status: resp.status, json };
}

async function fetchGitHubUserLabel(accessToken: string): Promise<string | null> {
  try {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Qlix-Connectors',
    };
    const { ok, json: user } = await fetchJson(`${GITHUB_API}/user`, { headers });
    if (!ok) return null;
    const login = typeof user.login === 'string' ? user.login : null;
    const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : null;
    let email = typeof user.email === 'string' ? user.email : null;

    if (!email) {
      const resp = await fetch(`${GITHUB_API}/user/emails`, { headers });
      if (resp.ok) {
        const emails = (await resp.json()) as Array<{
          email?: string;
          primary?: boolean;
          verified?: boolean;
        }>;
        const primary =
          emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified) ?? emails[0];
        email = typeof primary?.email === 'string' ? primary.email : null;
      }
    }

    const label = name && login ? `${name} (@${login})` : login ? `@${login}` : null;
    if (label && email) return `${label} · ${email}`;
    if (label) return label;
    return email;
  } catch {
    return null;
  }
}

export async function exchangeGitHubCode(code: string): Promise<StoredOAuthTokens> {
  const { clientId, clientSecret, redirectUri } = githubClientConfig();
  const { ok, status, json: tokenResp } = await fetchJson(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!ok || tokenResp.error) {
    const errMsg =
      typeof tokenResp.error_description === 'string'
        ? tokenResp.error_description
        : typeof tokenResp.error === 'string'
          ? tokenResp.error
          : `HTTP ${status}`;
    throw new Error(`GitHub token exchange failed: ${errMsg}`);
  }

  const accessToken = String(tokenResp.access_token ?? '');
  if (!accessToken) throw new Error('GitHub OAuth did not return an access token');

  const scopeRaw = String(tokenResp.scope ?? '');
  const scopes = scopeRaw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const emailAddress = await fetchGitHubUserLabel(accessToken);

  // Classic GitHub OAuth App tokens do not expire / refresh; store empty refresh.
  return {
    accessToken,
    refreshToken: '',
    expiresAtMs: null,
    scopes: scopes.length > 0 ? scopes : [...GITHUB_CONNECTOR_SCOPES],
    emailAddress,
  };
}

/** Best-effort revoke via GitHub Apps credentials API. */
export async function revokeGitHubToken(token: string): Promise<void> {
  if (!token) return;
  try {
    const { clientId, clientSecret } = githubClientConfig();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    await fetch(`${GITHUB_API}/applications/${clientId}/token`, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Qlix-Connectors',
      },
      body: JSON.stringify({ access_token: token }),
    });
  } catch {
    // Local disconnect proceeds even if revoke fails.
  }
}
