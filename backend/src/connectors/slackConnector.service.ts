import { ConnectorsRepository } from './connectors.repository.js';
import type { StoredOAuthTokens } from './connectors.types.js';
import { slackConnectorNotConnectedMessage } from './connectorUserMessages.js';
import { ConnectorNotConfiguredError } from './emailTool.service.js';
import { refreshSlackUserToken } from './slackOAuth.service.js';

const repo = new ConnectorsRepository();

export interface SlackSession {
  orgId: string;
  credentials: StoredOAuthTokens;
}

export async function resolveSlackSession(orgId: string | null): Promise<SlackSession> {
  if (!orgId) throw new ConnectorNotConfiguredError(slackConnectorNotConnectedMessage());
  const tokens = await repo.loadTokens(orgId, 'slack');
  if (!tokens?.accessToken) {
    throw new ConnectorNotConfiguredError(slackConnectorNotConnectedMessage());
  }
  return { orgId, credentials: tokens };
}

export async function refreshSlackSession(session: SlackSession): Promise<SlackSession> {
  const { credentials, orgId } = session;
  if (!credentials.refreshToken) return session;
  const expiresAt = credentials.expiresAtMs;
  if (expiresAt && expiresAt > Date.now() + 60_000) return session;

  try {
    const refreshed = await refreshSlackUserToken(credentials.refreshToken);
    const next: StoredOAuthTokens = {
      ...credentials,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAtMs: refreshed.expiresAtMs,
    };
    await repo.saveTokens(orgId, 'slack', next);
    return { orgId, credentials: next };
  } catch {
    return session;
  }
}

export async function loadSlackUserToken(orgId: string): Promise<string | null> {
  const session = await refreshSlackSession(await resolveSlackSession(orgId));
  return session.credentials.accessToken || null;
}
