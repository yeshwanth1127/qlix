import { ConnectorsRepository } from '../connectors.repository.js';
import type { ConnectorProvider, StoredOAuthTokens } from '../connectors.types.js';
import { crmConnectorNotConnectedMessage } from '../connectorUserMessages.js';
import { ConnectorNotConfiguredError } from '../emailTool.service.js';
import {
  CRM_CONNECTOR_PROVIDERS,
  connectorProviderToCrmPlatform,
  type CrmPlatformId,
  type CrmSession,
} from './crm.types.js';
import { getCrmAdapter } from './crmRegistry.js';

const repo = new ConnectorsRepository();

export async function resolveCrmSession(orgId: string | null): Promise<CrmSession> {
  if (!orgId) throw new ConnectorNotConfiguredError(crmConnectorNotConnectedMessage());

  for (const provider of CRM_CONNECTOR_PROVIDERS) {
    const tokens = await repo.loadTokens(orgId, provider);
    if (!tokens?.accessToken) continue;
    const platform = connectorProviderToCrmPlatform(provider);
    if (!platform) continue;
    return {
      platform,
      connectorProvider: provider,
      orgId,
      credentials: tokens,
    };
  }

  throw new ConnectorNotConfiguredError(crmConnectorNotConnectedMessage());
}

export async function persistCrmSession(session: CrmSession): Promise<void> {
  await repo.saveTokens(session.orgId, session.connectorProvider, session.credentials);
}

export async function refreshCrmSession(session: CrmSession): Promise<CrmSession> {
  const adapter = getCrmAdapter(session.platform);
  const refreshed = await adapter.refreshSession(session);
  await persistCrmSession(refreshed);
  return refreshed;
}

export async function loadCrmTokens(
  orgId: string,
  provider: ConnectorProvider,
): Promise<StoredOAuthTokens | null> {
  return repo.loadTokens(orgId, provider);
}

export function crmPlatformForProvider(provider: ConnectorProvider): CrmPlatformId | null {
  return connectorProviderToCrmPlatform(provider);
}
