import jwt from 'jsonwebtoken';
import { loadJwtSecret } from '../middleware/authenticateUser.js';
import type { StoredOAuthTokens } from './connectors.types.js';

/**
 * Notion public integration OAuth.
 * Notion Developer portal → Public connection → OAuth Domain & URIs → Redirect URI
 * must exactly match NOTION_OAUTH_REDIRECT_URI.
 *
 * @see https://developers.notion.com/docs/authorization
 */
const NOTION_AUTH_URL = 'https://api.notion.com/v1/oauth/authorize';
const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token';
const NOTION_VERSION = '2022-06-28';

export class NotionOAuthNotConfiguredError extends Error {
  readonly code = 'notion_oauth_not_configured';
}

function notionClientConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.NOTION_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new NotionOAuthNotConfiguredError(
      'Set NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET, and NOTION_OAUTH_REDIRECT_URI',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

export function mintNotionOAuthState(userId: string, orgId: string): string {
  const secret = loadJwtSecret();
  return jwt.sign({ sub: userId, orgId, qlixOAuth: 'notion_connector' }, secret, {
    expiresIn: 600,
    issuer: 'qlix-backend',
    algorithm: 'HS256',
  });
}

export function verifyNotionOAuthState(state: string): { userId: string; orgId: string } {
  const secret = loadJwtSecret();
  const decoded = jwt.verify(state, secret, { issuer: 'qlix-backend', algorithms: ['HS256'] });
  if (typeof decoded !== 'object' || decoded === null) throw new Error('Invalid OAuth state');
  const record = decoded as Record<string, unknown>;
  if (record.qlixOAuth !== 'notion_connector') throw new Error('Invalid OAuth state purpose');
  if (typeof record.sub !== 'string' || typeof record.orgId !== 'string') {
    throw new Error('Invalid OAuth state claims');
  }
  return { userId: record.sub, orgId: record.orgId };
}

export function buildNotionAuthUrl(state: string): string {
  const { clientId, redirectUri } = notionClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    owner: 'user',
    redirect_uri: redirectUri,
    state,
  });
  return `${NOTION_AUTH_URL}?${params.toString()}`;
}

async function notionJsonPost(
  url: string,
  body: Record<string, string>,
  authHeader: string,
): Promise<Record<string, unknown>> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify(body),
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
      typeof parsed.error === 'string'
        ? `${parsed.error}${typeof parsed.message === 'string' ? `: ${parsed.message}` : ''}`
        : text.slice(0, 400);
    throw new Error(`Notion OAuth HTTP ${resp.status}: ${errMsg}`);
  }
  return parsed;
}

function displayFromTokenResp(tokenResp: Record<string, unknown>): string | null {
  const workspaceName =
    typeof tokenResp.workspace_name === 'string' ? tokenResp.workspace_name.trim() : '';
  const owner = tokenResp.owner as Record<string, unknown> | undefined;
  const user = owner?.user as Record<string, unknown> | undefined;
  const person = user?.person as Record<string, unknown> | undefined;
  const email = typeof person?.email === 'string' ? person.email : null;
  const name = typeof user?.name === 'string' ? user.name.trim() : '';
  if (workspaceName && email) return `${workspaceName} · ${email}`;
  if (workspaceName && name) return `${workspaceName} · ${name}`;
  if (workspaceName) return workspaceName;
  if (email) return email;
  return name || null;
}

export async function exchangeNotionCode(code: string): Promise<StoredOAuthTokens> {
  const { clientId, clientSecret, redirectUri } = notionClientConfig();
  const tokenResp = await notionJsonPost(
    NOTION_TOKEN_URL,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    },
    basicAuthHeader(clientId, clientSecret),
  );

  const accessToken = String(tokenResp.access_token ?? '');
  if (!accessToken) throw new Error('Notion OAuth did not return an access token');

  const refreshToken = String(tokenResp.refresh_token ?? '');
  const workspaceId = typeof tokenResp.workspace_id === 'string' ? tokenResp.workspace_id : null;
  const workspaceName =
    typeof tokenResp.workspace_name === 'string' ? tokenResp.workspace_name : null;

  return {
    accessToken,
    refreshToken,
    expiresAtMs: null,
    scopes: [],
    emailAddress: displayFromTokenResp(tokenResp),
    teamId: workspaceId,
    teamName: workspaceName,
  };
}

/** Notion access tokens are long-lived; refresh support when Notion returns refresh_token. */
export async function refreshNotionToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number | null;
}> {
  const { clientId, clientSecret } = notionClientConfig();
  const tokenResp = await notionJsonPost(
    NOTION_TOKEN_URL,
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
    basicAuthHeader(clientId, clientSecret),
  );
  const accessToken = String(tokenResp.access_token ?? '');
  if (!accessToken) throw new Error('Notion refresh did not return access_token');
  return {
    accessToken,
    refreshToken: String(tokenResp.refresh_token ?? refreshToken),
    expiresAtMs: null,
  };
}

/** Best-effort local disconnect only — Notion has no public per-token revoke for bots. */
export async function revokeNotionToken(_token: string): Promise<void> {
  // Local disconnect proceeds even if Notion has no revoke endpoint.
}
