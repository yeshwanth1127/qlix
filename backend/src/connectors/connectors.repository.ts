import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { decryptForAgentSecrets, encryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import type {
  ConnectorAccountDTO,
  ConnectorProvider,
  ConnectorStatus,
  StoredOAuthTokens,
  StoredOrbitCredentials,
} from './connectors.types.js';

function toDto(row: {
  id: string;
  orgId: string;
  userId: string;
  provider: string;
  status: string;
  scopes: string[];
  emailAddress: string | null;
  whatsappOwnerJid: string | null;
  whatsappDefaultAgentId: string | null;
  whatsappDefaultTeamId: string | null;
  connectedAt: Date;
  updatedAt: Date;
}): ConnectorAccountDTO {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    provider: row.provider as ConnectorProvider,
    status: row.status as ConnectorStatus,
    scopes: row.scopes,
    emailAddress: row.emailAddress,
    whatsappOwnerJid: row.whatsappOwnerJid,
    whatsappDefaultAgentId: row.whatsappDefaultAgentId,
    whatsappDefaultTeamId: row.whatsappDefaultTeamId,
    connectedAt: row.connectedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ConnectorsRepository {
  async findByOrgProvider(orgId: string, provider: ConnectorProvider): Promise<ConnectorAccountDTO | null> {
    const row = await prisma.connectorAccount.findUnique({
      where: { orgId_provider: { orgId, provider } },
    });
    return row ? toDto(row) : null;
  }

  async listForOrg(orgId: string): Promise<ConnectorAccountDTO[]> {
    const rows = await prisma.connectorAccount.findMany({ where: { orgId } });
    return rows.map(toDto);
  }

  async upsertGoogle(params: {
    orgId: string;
    userId: string;
    tokens: StoredOAuthTokens;
  }): Promise<ConnectorAccountDTO> {
    const tokenEnc = encryptForAgentSecrets(JSON.stringify(params.tokens));
    const row = await prisma.connectorAccount.upsert({
      where: { orgId_provider: { orgId: params.orgId, provider: 'google' } },
      create: {
        orgId: params.orgId,
        userId: params.userId,
        provider: 'google',
        status: 'connected',
        scopes: params.tokens.scopes,
        emailAddress: params.tokens.emailAddress,
        tokenEnc,
        tokenExpiresAt: params.tokens.expiresAtMs ? new Date(params.tokens.expiresAtMs) : null,
      },
      update: {
        userId: params.userId,
        status: 'connected',
        scopes: params.tokens.scopes,
        emailAddress: params.tokens.emailAddress,
        tokenEnc,
        tokenExpiresAt: params.tokens.expiresAtMs ? new Date(params.tokens.expiresAtMs) : null,
      },
    });
    return toDto(row);
  }

  async upsertZoho(params: {
    orgId: string;
    userId: string;
    tokens: StoredOAuthTokens;
  }): Promise<ConnectorAccountDTO> {
    const tokenEnc = encryptForAgentSecrets(JSON.stringify(params.tokens));
    const row = await prisma.connectorAccount.upsert({
      where: { orgId_provider: { orgId: params.orgId, provider: 'zoho' } },
      create: {
        orgId: params.orgId,
        userId: params.userId,
        provider: 'zoho',
        status: 'connected',
        scopes: params.tokens.scopes,
        emailAddress: params.tokens.emailAddress,
        tokenEnc,
        tokenExpiresAt: params.tokens.expiresAtMs ? new Date(params.tokens.expiresAtMs) : null,
      },
      update: {
        userId: params.userId,
        status: 'connected',
        scopes: params.tokens.scopes,
        emailAddress: params.tokens.emailAddress,
        tokenEnc,
        tokenExpiresAt: params.tokens.expiresAtMs ? new Date(params.tokens.expiresAtMs) : null,
      },
    });
    return toDto(row);
  }

  async upsertSlack(params: {
    orgId: string;
    userId: string;
    tokens: StoredOAuthTokens;
  }): Promise<ConnectorAccountDTO> {
    const tokenEnc = encryptForAgentSecrets(JSON.stringify(params.tokens));
    const display =
      params.tokens.emailAddress ??
      (params.tokens.teamName ? `${params.tokens.teamName} (Slack)` : 'Slack workspace');
    const row = await prisma.connectorAccount.upsert({
      where: { orgId_provider: { orgId: params.orgId, provider: 'slack' } },
      create: {
        orgId: params.orgId,
        userId: params.userId,
        provider: 'slack',
        status: 'connected',
        scopes: params.tokens.scopes,
        emailAddress: display,
        tokenEnc,
        tokenExpiresAt: params.tokens.expiresAtMs ? new Date(params.tokens.expiresAtMs) : null,
      },
      update: {
        userId: params.userId,
        status: 'connected',
        scopes: params.tokens.scopes,
        emailAddress: display,
        tokenEnc,
        tokenExpiresAt: params.tokens.expiresAtMs ? new Date(params.tokens.expiresAtMs) : null,
      },
    });
    return toDto(row);
  }

  async loadTokens(orgId: string, provider: ConnectorProvider): Promise<StoredOAuthTokens | null> {
    const row = await prisma.connectorAccount.findUnique({
      where: { orgId_provider: { orgId, provider } },
    });
    if (!row || row.status !== 'connected') return null;
    try {
      const parsed = JSON.parse(decryptForAgentSecrets(row.tokenEnc)) as StoredOAuthTokens;
      return parsed;
    } catch {
      return null;
    }
  }

  async saveTokens(orgId: string, provider: ConnectorProvider, tokens: StoredOAuthTokens): Promise<void> {
    const tokenEnc = encryptForAgentSecrets(JSON.stringify(tokens));
    await prisma.connectorAccount.update({
      where: { orgId_provider: { orgId, provider } },
      data: {
        tokenEnc,
        tokenExpiresAt: tokens.expiresAtMs ? new Date(tokens.expiresAtMs) : null,
        scopes: tokens.scopes,
        emailAddress: tokens.emailAddress,
        status: 'connected',
      },
    });
  }

  async delete(orgId: string, provider: ConnectorProvider): Promise<void> {
    await prisma.connectorAccount.deleteMany({ where: { orgId, provider } });
  }

  async upsertOrbit(params: {
    orgId: string;
    userId: string;
    credentials: StoredOrbitCredentials;
    label?: string | null;
  }): Promise<ConnectorAccountDTO> {
    const tokenEnc = encryptForAgentSecrets(JSON.stringify(params.credentials));
    const row = await prisma.connectorAccount.upsert({
      where: { orgId_provider: { orgId: params.orgId, provider: 'orbit' } },
      create: {
        orgId: params.orgId,
        userId: params.userId,
        provider: 'orbit',
        status: 'connected',
        scopes: ['social.read', 'social.publish'],
        emailAddress: params.label ?? params.credentials.baseUrl,
        tokenEnc,
        tokenExpiresAt: null,
      },
      update: {
        userId: params.userId,
        status: 'connected',
        scopes: ['social.read', 'social.publish'],
        emailAddress: params.label ?? params.credentials.baseUrl,
        tokenEnc,
        tokenExpiresAt: null,
      },
    });
    return toDto(row);
  }

  async loadOrbitCredentials(orgId: string): Promise<StoredOrbitCredentials | null> {
    const row = await prisma.connectorAccount.findUnique({
      where: { orgId_provider: { orgId, provider: 'orbit' } },
    });
    if (!row || row.status !== 'connected') return null;
    try {
      const parsed = JSON.parse(decryptForAgentSecrets(row.tokenEnc)) as StoredOrbitCredentials;
      if (!parsed?.apiKey || !parsed?.baseUrl) return null;
      return {
        apiKey: parsed.apiKey,
        baseUrl: parsed.baseUrl.replace(/\/$/, ''),
        channelIds: Array.isArray(parsed.channelIds) ? parsed.channelIds : [],
        pendingClaimAtMs: parsed.pendingClaimAtMs ?? null,
        groupId: parsed.groupId ?? null,
        groupName: parsed.groupName ?? null,
      };
    } catch {
      return null;
    }
  }

  async upsertWhatsAppPending(params: {
    orgId: string;
    userId: string;
  }): Promise<ConnectorAccountDTO> {
    const row = await prisma.connectorAccount.upsert({
      where: { orgId_provider: { orgId: params.orgId, provider: 'whatsapp_baileys' } },
      create: {
        orgId: params.orgId,
        userId: params.userId,
        provider: 'whatsapp_baileys',
        status: 'pending_qr',
        scopes: [],
        tokenEnc: encryptForAgentSecrets('{}'),
      },
      update: {
        userId: params.userId,
        status: 'pending_qr',
        whatsappOwnerJid: null,
        emailAddress: null,
      },
    });
    return toDto(row);
  }

  async markWhatsAppConnected(params: {
    connectorId: string;
    ownerJid: string;
    phoneDisplay: string | null;
  }): Promise<ConnectorAccountDTO> {
    const row = await prisma.connectorAccount.update({
      where: { id: params.connectorId },
      data: {
        status: 'connected',
        whatsappOwnerJid: params.ownerJid,
        emailAddress: params.phoneDisplay,
      },
    });
    return toDto(row);
  }

  /** Baileys reported `loggedOut` (session invalidated, e.g. unlinked from the phone) — surface it in the dashboard instead of leaving `status: 'connected'` stale forever. */
  async markWhatsAppDisconnected(connectorId: string): Promise<ConnectorAccountDTO> {
    const row = await prisma.connectorAccount.update({
      where: { id: connectorId },
      data: { status: 'revoked' },
    });
    return toDto(row);
  }

  async setWhatsAppDefaultAgent(connectorId: string, agentId: string | null): Promise<ConnectorAccountDTO> {
    const row = await prisma.connectorAccount.update({
      where: { id: connectorId },
      data: { whatsappDefaultAgentId: agentId },
    });
    return toDto(row);
  }

  async setWhatsAppDefaultTeam(connectorId: string, teamId: string | null): Promise<ConnectorAccountDTO> {
    const row = await prisma.connectorAccount.update({
      where: { id: connectorId },
      data: { whatsappDefaultTeamId: teamId },
    });
    return toDto(row);
  }

  async findByWhatsAppOwnerJid(ownerJid: string): Promise<ConnectorAccountDTO | null> {
    const row = await prisma.connectorAccount.findFirst({
      where: { provider: 'whatsapp_baileys', whatsappOwnerJid: ownerJid, status: 'connected' },
    });
    return row ? toDto(row) : null;
  }

  async findById(connectorId: string): Promise<ConnectorAccountDTO | null> {
    const row = await prisma.connectorAccount.findUnique({ where: { id: connectorId } });
    return row ? toDto(row) : null;
  }

  async getN8nSettings(orgId: string): Promise<{
    n8nBaseUrl: string | null;
    n8nWebhookSecretEnc: string | null;
    n8nEmailReadPath: string;
    n8nEmailSendPath: string;
  } | null> {
    return prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        n8nBaseUrl: true,
        n8nWebhookSecretEnc: true,
        n8nEmailReadPath: true,
        n8nEmailSendPath: true,
      },
    });
  }

  async updateN8nSettings(
    orgId: string,
    data: {
      n8nBaseUrl: string;
      n8nWebhookSecretEnc: string;
      n8nEmailReadPath?: string;
      n8nEmailSendPath?: string;
    },
  ): Promise<void> {
    const patch: Prisma.OrganizationUpdateInput = {
      n8nBaseUrl: data.n8nBaseUrl.replace(/\/$/, ''),
      n8nWebhookSecretEnc: data.n8nWebhookSecretEnc,
    };
    if (data.n8nEmailReadPath) patch.n8nEmailReadPath = data.n8nEmailReadPath;
    if (data.n8nEmailSendPath) patch.n8nEmailSendPath = data.n8nEmailSendPath;
    await prisma.organization.update({ where: { id: orgId }, data: patch });
  }
}
