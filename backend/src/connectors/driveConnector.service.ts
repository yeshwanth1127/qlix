import { ConnectorsRepository } from './connectors.repository.js';
import type { StoredOAuthTokens } from './connectors.types.js';
import { refreshGoogleAccessToken } from './googleOAuth.service.js';
import { googleServiceConnected } from './googleServices.js';
import { refreshMicrosoftToken } from './microsoftOAuth.service.js';

const repo = new ConnectorsRepository();
const TOKEN_REFRESH_BUFFER_MS = 60_000;

export type DriveProviderId = 'google' | 'microsoft';

export class DriveProviderSelectionRequiredError extends Error {
  readonly code = 'drive_provider_selection_required';
  readonly providers: Array<{ id: DriveProviderId; label: string }>;

  constructor(providers: Array<{ id: DriveProviderId; label: string }>) {
    super(
      'More than one cloud drive is connected. Ask the user which drive to use (Google Drive or OneDrive), then retry with provider "google" or "microsoft".',
    );
    this.providers = providers;
  }
}

export class DriveProviderNotAvailableError extends Error {
  readonly code = 'drive_provider_not_available';
  constructor(provider: DriveProviderId) {
    super(
      `The requested ${provider === 'google' ? 'Google Drive' : 'OneDrive'} is not connected or lacks the required permission.`,
    );
  }
}

export type ResolvedDriveSession = {
  provider: DriveProviderId;
  accessToken: string;
  tokens: StoredOAuthTokens;
  label: string | null;
};

function displayLabel(provider: DriveProviderId, emailAddress: string | null): string {
  const service = provider === 'google' ? 'Google Drive' : 'OneDrive';
  return emailAddress?.trim() ? `${service} (${emailAddress.trim()})` : service;
}

/** True when Microsoft OAuth scopes include OneDrive file access. */
export function isMicrosoftDriveCapable(tokens: StoredOAuthTokens): boolean {
  return tokens.scopes.some((scope) => {
    const s = scope.toLowerCase();
    return (
      s === 'files.readwrite.all' ||
      s === 'files.readwrite' ||
      s.endsWith('/files.readwrite.all') ||
      s.endsWith('/files.readwrite') ||
      s.includes('files.readwrite')
    );
  });
}

async function refreshAccessToken(
  orgId: string,
  provider: DriveProviderId,
  tokens: StoredOAuthTokens,
): Promise<StoredOAuthTokens> {
  if (!tokens.expiresAtMs || tokens.expiresAtMs - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
    return tokens;
  }

  if (provider === 'google') {
    const refreshed = await refreshGoogleAccessToken(tokens.refreshToken);
    const updated = { ...tokens, accessToken: refreshed.accessToken, expiresAtMs: refreshed.expiresAtMs };
    await repo.saveTokens(orgId, provider, updated);
    return updated;
  }

  if (!tokens.refreshToken) {
    throw new DriveProviderNotAvailableError('microsoft');
  }
  const refreshed = await refreshMicrosoftToken(tokens.refreshToken);
  const updated = {
    ...tokens,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAtMs: refreshed.expiresAtMs,
    scopes: refreshed.scopes.length > 0 ? refreshed.scopes : tokens.scopes,
  };
  await repo.saveTokens(orgId, provider, updated);
  return updated;
}

/** Resolve Google Drive or OneDrive. Choice is never persisted. */
export async function resolveDriveSession(params: {
  orgId: string;
  provider?: DriveProviderId;
}): Promise<ResolvedDriveSession | null> {
  const candidates: Array<{ provider: DriveProviderId; tokens: StoredOAuthTokens }> = [];

  const google = await repo.loadTokens(params.orgId, 'google');
  if (google && googleServiceConnected('drive', google.scopes)) {
    candidates.push({ provider: 'google', tokens: google });
  }

  const microsoft = await repo.loadTokens(params.orgId, 'microsoft');
  if (microsoft && isMicrosoftDriveCapable(microsoft)) {
    candidates.push({ provider: 'microsoft', tokens: microsoft });
  }

  if (params.provider) {
    const selected = candidates.find((c) => c.provider === params.provider);
    if (!selected) throw new DriveProviderNotAvailableError(params.provider);
    const tokens = await refreshAccessToken(params.orgId, selected.provider, selected.tokens);
    return {
      provider: selected.provider,
      accessToken: tokens.accessToken,
      tokens,
      label: tokens.emailAddress,
    };
  }

  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    throw new DriveProviderSelectionRequiredError(
      candidates.map(({ provider, tokens }) => ({
        id: provider,
        label: displayLabel(provider, tokens.emailAddress),
      })),
    );
  }

  const selected = candidates[0];
  const tokens = await refreshAccessToken(params.orgId, selected.provider, selected.tokens);
  return {
    provider: selected.provider,
    accessToken: tokens.accessToken,
    tokens,
    label: tokens.emailAddress,
  };
}

export async function hasDriveConnector(orgId: string): Promise<boolean> {
  return Boolean(
    await resolveDriveSession({ orgId }).catch(
      (err) => err instanceof DriveProviderSelectionRequiredError,
    ),
  );
}
