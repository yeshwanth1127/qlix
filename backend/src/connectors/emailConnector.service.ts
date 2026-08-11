import { ConnectorsRepository } from './connectors.repository.js';
import type { EmailProviderId, StoredOAuthTokens } from './connectors.types.js';
import { refreshGoogleAccessToken } from './googleOAuth.service.js';
import { googleServiceConnected } from './googleServices.js';
import { refreshMicrosoftToken } from './microsoftOAuth.service.js';

const repo = new ConnectorsRepository();
const TOKEN_REFRESH_BUFFER_MS = 60_000;

export class EmailProviderSelectionRequiredError extends Error {
  readonly code = 'email_provider_selection_required';
  readonly providers: Array<{ id: EmailProviderId; label: string }>;

  constructor(providers: Array<{ id: EmailProviderId; label: string }>) {
    super('More than one email mailbox is connected. Ask the user which mailbox to use, then retry with provider "google" or "microsoft".');
    this.providers = providers;
  }
}

export class EmailProviderNotAvailableError extends Error {
  readonly code = 'email_provider_not_available';
  constructor(provider: EmailProviderId) {
    super(`The requested ${provider === 'google' ? 'Gmail' : 'Microsoft 365'} mailbox is not connected or lacks the required permission.`);
  }
}

export type ResolvedEmailSession = {
  provider: EmailProviderId;
  accessToken: string;
  tokens: StoredOAuthTokens;
  mailboxEmail: string | null;
};

function displayLabel(provider: EmailProviderId, emailAddress: string | null): string {
  const service = provider === 'google' ? 'Gmail' : 'Microsoft 365';
  return emailAddress?.trim() ? `${service} (${emailAddress.trim()})` : service;
}

function isMicrosoftMailCapable(tokens: StoredOAuthTokens, operation: 'read' | 'send' | 'draft'): boolean {
  const scopes = new Set(tokens.scopes.map((scope) => scope.toLowerCase()));
  if (operation === 'send') return scopes.has('mail.send');
  return scopes.has('mail.readwrite');
}

async function refreshAccessToken(
  orgId: string,
  provider: EmailProviderId,
  tokens: StoredOAuthTokens,
): Promise<StoredOAuthTokens> {
  if (!tokens.expiresAtMs || tokens.expiresAtMs - Date.now() > TOKEN_REFRESH_BUFFER_MS) return tokens;

  if (provider === 'google') {
    const refreshed = await refreshGoogleAccessToken(tokens.refreshToken);
    const updated = { ...tokens, accessToken: refreshed.accessToken, expiresAtMs: refreshed.expiresAtMs };
    await repo.saveTokens(orgId, provider, updated);
    return updated;
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

/** Resolve the selected email mailbox. A choice is intentionally never persisted. */
export async function resolveEmailSession(params: {
  orgId: string;
  provider?: EmailProviderId;
  operation: 'read' | 'send' | 'draft';
}): Promise<ResolvedEmailSession | null> {
  const candidates: Array<{ provider: EmailProviderId; tokens: StoredOAuthTokens }> = [];
  const google = await repo.loadTokens(params.orgId, 'google');
  if (google && googleServiceConnected('gmail', google.scopes)) candidates.push({ provider: 'google', tokens: google });

  const microsoft = await repo.loadTokens(params.orgId, 'microsoft');
  if (microsoft && isMicrosoftMailCapable(microsoft, params.operation)) {
    candidates.push({ provider: 'microsoft', tokens: microsoft });
  }

  if (params.provider) {
    const selected = candidates.find((candidate) => candidate.provider === params.provider);
    if (!selected) throw new EmailProviderNotAvailableError(params.provider);
    const tokens = await refreshAccessToken(params.orgId, selected.provider, selected.tokens);
    return { provider: selected.provider, accessToken: tokens.accessToken, tokens, mailboxEmail: tokens.emailAddress };
  }
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    throw new EmailProviderSelectionRequiredError(
      candidates.map(({ provider, tokens }) => ({ id: provider, label: displayLabel(provider, tokens.emailAddress) })),
    );
  }
  const selected = candidates[0];
  const tokens = await refreshAccessToken(params.orgId, selected.provider, selected.tokens);
  return {
    provider: selected.provider,
    accessToken: tokens.accessToken,
    tokens,
    mailboxEmail: tokens.emailAddress,
  };
}

export async function hasEmailConnector(orgId: string): Promise<boolean> {
  return Boolean(await resolveEmailSession({ orgId, operation: 'read', provider: undefined }).catch(
    (err) => err instanceof EmailProviderSelectionRequiredError,
  ));
}
