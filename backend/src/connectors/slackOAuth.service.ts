import jwt from 'jsonwebtoken';
import { loadJwtSecret } from '../middleware/authenticateUser.js';
import type { StoredOAuthTokens } from './connectors.types.js';
import { fetchSlackUserDisplayName } from './slackApi.service.js';

const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';

/** User token scopes — must match the Slack app OAuth & Permissions → User Token Scopes. */
export const SLACK_USER_SCOPES = [
  'channels:history',
  'channels:read',
  'channels:write',
  'channels:write.topic',
  'chat:write',
  'groups:history',
  'groups:read',
  'groups:write',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'search:read',
  'users:read',
  'users:write',
  'lists:read',
  'lists:write',
  'files:read',
];

export class SlackOAuthNotConfiguredError extends Error {
  readonly code = 'slack_oauth_not_configured';
}

function slackClientConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.SLACK_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.SLACK_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new SlackOAuthNotConfiguredError(
      'Set SLACK_OAUTH_CLIENT_ID, SLACK_OAUTH_CLIENT_SECRET, and SLACK_OAUTH_REDIRECT_URI',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function mintSlackOAuthState(userId: string, orgId: string): string {
  const secret = loadJwtSecret();
  return jwt.sign({ sub: userId, orgId, qlixOAuth: 'slack_connector' }, secret, {
    expiresIn: 600,
    issuer: 'qlix-backend',
    algorithm: 'HS256',
  });
}

export function verifySlackOAuthState(state: string): { userId: string; orgId: string } {
  const secret = loadJwtSecret();
  const decoded = jwt.verify(state, secret, { issuer: 'qlix-backend', algorithms: ['HS256'] });
  if (typeof decoded !== 'object' || decoded === null) throw new Error('Invalid OAuth state');
  const record = decoded as Record<string, unknown>;
  if (record.qlixOAuth !== 'slack_connector') throw new Error('Invalid OAuth state purpose');
  if (typeof record.sub !== 'string' || typeof record.orgId !== 'string') {
    throw new Error('Invalid OAuth state claims');
  }
  return { userId: record.sub, orgId: record.orgId };
}

export function buildSlackAuthUrl(state: string): string {
  const { clientId, redirectUri } = slackClientConfig();
  // User-token only (Option B): do not pass bot `scope` — that requires a Slack bot user.
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    user_scope: SLACK_USER_SCOPES.join(','),
    state,
  });
  return `${SLACK_AUTH_URL}?${params.toString()}`;
}

async function slackApiPost(
  method: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`https://slack.com/api/${method}`, {
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
    throw new Error(`Slack API HTTP ${resp.status}: ${text.slice(0, 400)}`);
  }
  if (parsed.ok === false) {
    throw new Error(`Slack API error: ${String(parsed.error ?? 'unknown')}`);
  }
  return parsed;
}

export async function exchangeSlackCode(code: string): Promise<StoredOAuthTokens> {
  const { clientId, clientSecret, redirectUri } = slackClientConfig();
  const tokenResp = await slackApiPost('oauth.v2.access', {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const authedUser = tokenResp.authed_user as Record<string, unknown> | undefined;
  const userAccessToken = String(authedUser?.access_token ?? '');
  if (!userAccessToken) {
    throw new Error('Slack OAuth did not return a user access token (check user scopes on the app)');
  }

  const botAccessToken =
    typeof tokenResp.access_token === 'string' ? tokenResp.access_token : null;
  const team = tokenResp.team as Record<string, unknown> | undefined;
  const teamId = typeof team?.id === 'string' ? team.id : null;
  const teamName = typeof team?.name === 'string' ? team.name : null;
  const slackUserId = typeof authedUser?.id === 'string' ? authedUser.id : null;

  const userScopeRaw = String(authedUser?.scope ?? '');
  const botScopeRaw = String(tokenResp.scope ?? '');
  const scopes = [...userScopeRaw.split(/[, ]+/), ...botScopeRaw.split(/[, ]+/)]
    .map((s) => s.trim())
    .filter(Boolean);

  const refreshToken = String(authedUser?.refresh_token ?? '');
  const expiresIn = Number(authedUser?.expires_in ?? 0);
  const expiresAtMs = expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;

  const emailAddress =
    (await fetchSlackUserDisplayName(userAccessToken, slackUserId)) ??
    (teamName && slackUserId ? `${teamName} · ${slackUserId}` : teamName);

  return {
    accessToken: userAccessToken,
    refreshToken,
    expiresAtMs,
    scopes,
    emailAddress,
    slackBotAccessToken: botAccessToken,
    teamId,
    teamName,
    slackUserId,
  };
}

export async function refreshSlackUserToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number | null;
}> {
  const { clientId, clientSecret } = slackClientConfig();
  const tokenResp = await slackApiPost('oauth.v2.access', {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const authedUser = tokenResp.authed_user as Record<string, unknown> | undefined;
  const accessToken = String(authedUser?.access_token ?? tokenResp.access_token ?? '');
  if (!accessToken) throw new Error('Slack refresh did not return access_token');
  const nextRefresh = String(authedUser?.refresh_token ?? refreshToken);
  const expiresIn = Number(authedUser?.expires_in ?? tokenResp.expires_in ?? 0);
  return {
    accessToken,
    refreshToken: nextRefresh,
    expiresAtMs: expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
  };
}

/** Best-effort revoke at Slack (auth.revoke). */
export async function revokeSlackToken(token: string): Promise<void> {
  if (!token) return;
  try {
    await slackApiPost('auth.revoke', { token });
  } catch {
    // Local disconnect proceeds even if revoke fails.
  }
}
