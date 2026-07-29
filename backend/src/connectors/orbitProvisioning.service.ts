/**
 * Platform Orbit credentials + per-Qlix-org channel isolation.
 *
 * One Orbit org / API key (ORBIT_API_KEY) is shared by the Qlix platform.
 * Each Qlix workspace gets its own ConnectorAccount that stores which Orbit
 * integration IDs it owns (channelIds). Agents only see/publish to those.
 */

import { prisma } from '../lib/prisma.js';
import { ConnectorsRepository } from './connectors.repository.js';
import type { ConnectorAccountDTO, StoredOrbitCredentials } from './connectors.types.js';
import {
  defaultOrbitBaseUrl,
  OrbitApiError,
  type OrbitChannelDTO,
  type OrbitCredentials,
  orbitListChannels,
  verifyOrbitCredentials,
} from './orbitClient.service.js';

const repo = new ConnectorsRepository();

const PENDING_CLAIM_MS = 45 * 60_000;

export class OrbitPlatformNotConfiguredError extends Error {
  readonly code = 'orbit_platform_not_configured';
  constructor(
    message = 'Orbit is not configured on this server. Set ORBIT_BASE_URL and ORBIT_API_KEY.',
  ) {
    super(message);
  }
}

export function getPlatformOrbitCredentials(): OrbitCredentials {
  const apiKey = process.env.ORBIT_API_KEY?.trim();
  const baseUrl = defaultOrbitBaseUrl();
  if (!apiKey) throw new OrbitPlatformNotConfiguredError();
  return { apiKey, baseUrl };
}

export function isOrbitPlatformConfigured(): boolean {
  return Boolean(process.env.ORBIT_API_KEY?.trim());
}

function normalizeCreds(raw: StoredOrbitCredentials, platform: OrbitCredentials): StoredOrbitCredentials {
  return {
    apiKey: platform.apiKey,
    baseUrl: platform.baseUrl,
    channelIds: Array.isArray(raw.channelIds) ? [...new Set(raw.channelIds.filter(Boolean))] : [],
    pendingClaimAtMs: raw.pendingClaimAtMs ?? null,
    groupId: raw.groupId ?? null,
    groupName: raw.groupName ?? null,
  };
}

async function loadFullOrbitCreds(orgId: string): Promise<StoredOrbitCredentials | null> {
  const platform = getPlatformOrbitCredentials();
  const row = await prisma.connectorAccount.findUnique({
    where: { orgId_provider: { orgId, provider: 'orbit' } },
  });
  if (!row || row.status !== 'connected') return null;
  const { decryptForAgentSecrets } = await import('../cloudRunners/agentSecrets.js');
  try {
    const parsed = JSON.parse(decryptForAgentSecrets(row.tokenEnc)) as StoredOrbitCredentials;
    return normalizeCreds(parsed, platform);
  } catch {
    return null;
  }
}

async function saveFullOrbitCreds(
  orgId: string,
  userId: string,
  creds: StoredOrbitCredentials,
  label?: string,
): Promise<ConnectorAccountDTO> {
  const platform = getPlatformOrbitCredentials();
  const next = normalizeCreds(creds, platform);
  const channelCount = next.channelIds.length;
  return repo.upsertOrbit({
    orgId,
    userId,
    credentials: next,
    label: label ?? `Orbit · ${channelCount} channel${channelCount === 1 ? '' : 's'}`,
  });
}

/** All Orbit integration IDs already claimed by any Qlix workspace. */
async function allClaimedChannelIds(exceptOrgId?: string): Promise<Set<string>> {
  const rows = await prisma.connectorAccount.findMany({
    where: { provider: 'orbit', status: 'connected' },
    select: { orgId: true, tokenEnc: true },
  });
  const { decryptForAgentSecrets } = await import('../cloudRunners/agentSecrets.js');
  const claimed = new Set<string>();
  for (const row of rows) {
    if (exceptOrgId && row.orgId === exceptOrgId) continue;
    try {
      const parsed = JSON.parse(decryptForAgentSecrets(row.tokenEnc)) as StoredOrbitCredentials;
      for (const id of parsed.channelIds ?? []) {
        if (id) claimed.add(id);
      }
    } catch {
      /* ignore corrupt rows */
    }
  }
  return claimed;
}

/** Enable Orbit for a workspace using the platform API key (no user paste). */
export async function enableOrbitForOrg(params: {
  orgId: string;
  userId: string;
}): Promise<{ connector: ConnectorAccountDTO; channelCount: number }> {
  const platform = getPlatformOrbitCredentials();
  await verifyOrbitCredentials(platform);

  const existing = await loadFullOrbitCreds(params.orgId);
  const creds: StoredOrbitCredentials = existing ?? {
    apiKey: platform.apiKey,
    baseUrl: platform.baseUrl,
    channelIds: [],
    pendingClaimAtMs: null,
    groupId: null,
    groupName: `qlix:${params.orgId}`,
  };

  // Always refresh apiKey/baseUrl from platform env (ops can rotate).
  creds.apiKey = platform.apiKey;
  creds.baseUrl = platform.baseUrl;
  if (!creds.groupName) creds.groupName = `qlix:${params.orgId}`;

  const connector = await saveFullOrbitCreds(params.orgId, params.userId, creds);
  return { connector, channelCount: creds.channelIds.length };
}

export async function markOrbitSocialPending(orgId: string, userId: string): Promise<void> {
  const creds = await loadFullOrbitCreds(orgId);
  if (!creds) throw new OrbitApiError('Orbit not enabled for this workspace', 404);
  creds.pendingClaimAtMs = Date.now();
  await saveFullOrbitCreds(orgId, userId, creds);
}

/**
 * List channels for this org only. If a social OAuth was recently started,
 * claim any Orbit integrations not yet owned by another Qlix workspace.
 */
export async function listOrbitChannelsForOrg(params: {
  orgId: string;
  userId: string;
  claim?: boolean;
}): Promise<{ channels: OrbitChannelDTO[]; claimedIds: string[] }> {
  const creds = await loadFullOrbitCreds(params.orgId);
  if (!creds) throw new OrbitApiError('Orbit not enabled for this workspace', 404);

  const all = await orbitListChannels({ apiKey: creds.apiKey, baseUrl: creds.baseUrl });
  const othersClaimed = await allClaimedChannelIds(params.orgId);
  const pending =
    creds.pendingClaimAtMs != null && Date.now() - creds.pendingClaimAtMs < PENDING_CLAIM_MS;

  const claimedNow: string[] = [];
  if (params.claim !== false && pending) {
    for (const ch of all) {
      if (!ch.id) continue;
      if (creds.channelIds.includes(ch.id)) continue;
      if (othersClaimed.has(ch.id)) continue;
      creds.channelIds.push(ch.id);
      claimedNow.push(ch.id);
    }
    // Always clear pending after a claim-capable refresh so we don't steal later channels.
    creds.pendingClaimAtMs = null;
    await saveFullOrbitCreds(params.orgId, params.userId, creds);
  }

  const mine = new Set(creds.channelIds);
  const channels = all.filter((ch) => mine.has(ch.id));
  return { channels, claimedIds: claimedNow };
}

export async function releaseOrbitChannel(
  orgId: string,
  userId: string,
  channelId: string,
): Promise<void> {
  const creds = await loadFullOrbitCreds(orgId);
  if (!creds) throw new OrbitApiError('Orbit not enabled for this workspace', 404);
  if (!creds.channelIds.includes(channelId)) {
    throw new OrbitApiError('Channel not linked to this workspace', 404);
  }
  // Delete from Orbit (shared org) then drop claim.
  const { orbitDeleteChannel } = await import('./orbitClient.service.js');
  await orbitDeleteChannel({ apiKey: creds.apiKey, baseUrl: creds.baseUrl }, channelId);
  creds.channelIds = creds.channelIds.filter((id) => id !== channelId);
  await saveFullOrbitCreds(orgId, userId, creds);
}

export async function assertOrbitChannelOwnedByOrg(orgId: string, integrationId: string): Promise<void> {
  const creds = await loadFullOrbitCreds(orgId);
  if (!creds) throw new OrbitApiError('Orbit not enabled for this workspace', 404);
  if (!creds.channelIds.includes(integrationId)) {
    throw new OrbitApiError('Channel not linked to this workspace', 403);
  }
}

export async function getOrbitCredsForOrg(orgId: string): Promise<StoredOrbitCredentials | null> {
  return loadFullOrbitCreds(orgId);
}
