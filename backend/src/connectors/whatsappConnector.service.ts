import { prisma } from '../lib/prisma.js';
import { ConnectorsRepository } from './connectors.repository.js';
import type { ConnectorAccountDTO, WhatsAppLinkStatusDTO } from './connectors.types.js';
import {
  getWhatsAppSessionStatus,
  isWhatsAppServiceConfigured,
  startWhatsAppSession,
  stopWhatsAppSession,
} from './whatsappServiceClient.js';

const repo = new ConnectorsRepository();

export class WhatsAppServiceNotConfiguredError extends Error {
  readonly code = 'whatsapp_service_not_configured';
}

export async function getWhatsAppConnectorForOrg(orgId: string): Promise<ConnectorAccountDTO | null> {
  return repo.findByOrgProvider(orgId, 'whatsapp_baileys');
}

export async function getConnectedWhatsAppForOrg(orgId: string): Promise<ConnectorAccountDTO | null> {
  const c = await getWhatsAppConnectorForOrg(orgId);
  if (!c || c.status !== 'connected' || !c.whatsappOwnerJid) return null;
  return c;
}

/** Resolve org for an agent (org workspace or agent's orgId). */
export async function getWhatsAppConnectorForAgent(agentId: string): Promise<ConnectorAccountDTO | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { orgId: true, userId: true },
  });
  if (!agent) return null;
  const orgId = agent.orgId;
  if (orgId) {
    return getConnectedWhatsAppForOrg(orgId);
  }
  const user = await prisma.user.findUnique({
    where: { id: agent.userId },
    select: { orgId: true },
  });
  if (!user) return null;
  return getConnectedWhatsAppForOrg(user.orgId);
}

export async function startWhatsAppLink(orgId: string, userId: string): Promise<WhatsAppLinkStatusDTO> {
  if (!isWhatsAppServiceConfigured()) {
    throw new WhatsAppServiceNotConfiguredError(
      'Set QLIX_WHATSAPP_SERVICE_URL and QLIX_INTERNAL_SERVICE_SECRET',
    );
  }
  const connector = await repo.upsertWhatsAppPending({ orgId, userId });
  const started = await startWhatsAppSession(connector.id);
  if (!started.ok) {
    await prisma.connectorAccount.update({
      where: { id: connector.id },
      data: { status: 'error' },
    });
    throw new Error(started.error ?? 'Failed to start WhatsApp session');
  }
  return pollLinkStatus(connector.id);
}

export async function pollLinkStatus(connectorId: string): Promise<WhatsAppLinkStatusDTO> {
  const connector = await repo.findById(connectorId);
  if (!connector) throw new Error('Connector not found');

  const session = await getWhatsAppSessionStatus(connectorId);

  if (session.ownerJid && connector.status !== 'connected') {
    const phone = session.ownerJid.replace(/@.*/, '').split(':')[0];
    const updated = await repo.markWhatsAppConnected({
      connectorId,
      ownerJid: session.ownerJid,
      phoneDisplay: phone,
    });
    return {
      connectorId,
      status: updated.status,
      qr: null,
      phone: updated.emailAddress,
      ownerJid: updated.whatsappOwnerJid,
    };
  }

  if (connector.status === 'connected') {
    const resumed = await startWhatsAppSession(connectorId);
    if (!resumed.ok) {
      console.warn('[whatsapp] session resume failed:', resumed.error);
    }
    const live = await getWhatsAppSessionStatus(connectorId);
    return {
      connectorId,
      status: connector.status,
      qr: live.qr,
      phone: connector.emailAddress,
      ownerJid: live.ownerJid ?? connector.whatsappOwnerJid,
    };
  }

  return {
    connectorId,
    status: connector.status,
    qr: session.qr,
    phone: connector.emailAddress,
    ownerJid: connector.whatsappOwnerJid,
  };
}

export async function disconnectWhatsApp(orgId: string): Promise<void> {
  const connector = await repo.findByOrgProvider(orgId, 'whatsapp_baileys');
  if (!connector) return;
  await stopWhatsAppSession(connector.id);
  await repo.delete(orgId, 'whatsapp_baileys');
}

export async function resolveConnectorByOwnerJid(ownerJid: string): Promise<ConnectorAccountDTO | null> {
  return repo.findByWhatsAppOwnerJid(ownerJid);
}
