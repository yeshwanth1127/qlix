import { ConnectorsRepository } from './connectors.repository.js';
import type { StoredOAuthTokens } from './connectors.types.js';
import { notionConnectorNotConnectedMessage } from './connectorUserMessages.js';
import { ConnectorNotConfiguredError } from './emailTool.service.js';
import { refreshNotionToken } from './notionOAuth.service.js';

const repo = new ConnectorsRepository();

export interface NotionSession {
  orgId: string;
  credentials: StoredOAuthTokens;
}

export async function resolveNotionSession(orgId: string | null): Promise<NotionSession> {
  if (!orgId) throw new ConnectorNotConfiguredError(notionConnectorNotConnectedMessage());
  const tokens = await repo.loadTokens(orgId, 'notion');
  if (!tokens?.accessToken) {
    throw new ConnectorNotConfiguredError(notionConnectorNotConnectedMessage());
  }
  return { orgId, credentials: tokens };
}

export async function refreshNotionSession(session: NotionSession): Promise<NotionSession> {
  const { credentials, orgId } = session;
  if (!credentials.refreshToken) return session;
  const expiresAt = credentials.expiresAtMs;
  if (expiresAt && expiresAt > Date.now() + 60_000) return session;

  try {
    const refreshed = await refreshNotionToken(credentials.refreshToken);
    const next: StoredOAuthTokens = {
      ...credentials,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAtMs: refreshed.expiresAtMs,
    };
    await repo.saveTokens(orgId, 'notion', next);
    return { orgId, credentials: next };
  } catch {
    return session;
  }
}
