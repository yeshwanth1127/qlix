import { prisma } from '../../lib/prisma.js';
import type { ChannelAdapter, DeliveryTarget, InboundMessage, ReplyPayload } from '../types.js';

function isWhatsAppContactJid(peerId: string | null | undefined): boolean {
  if (!peerId) return false;
  const p = peerId.toLowerCase();
  return p.endsWith('@s.whatsapp.net') || p.endsWith('@lid') || p.endsWith('@c.us');
}

/**
 * WhatsApp channel adapter — delivery via existing notifier; inbound builders
 * normalize sidecar text into gateway InboundMessage.
 */
export const whatsappAdapter: ChannelAdapter = {
  channel: 'whatsapp',
  async deliver(target: DeliveryTarget, payload: ReplyPayload): Promise<void> {
    const run = await prisma.agentRun.findUnique({
      where: { id: payload.runId },
      select: {
        teamRole: true,
        status: true,
        result: true,
        errorMessage: true,
        prompt: true,
        orgId: true,
        userId: true,
        whatsappReplyToJid: true,
        agent: { select: { name: true, description: true, orgId: true } },
      },
    });
    if (!run) return;

    const orgId = run.orgId ?? run.agent?.orgId;
    if (!orgId) return;

    const fromWhatsAppChannel = run.teamRole === 'whatsapp';
    const body =
      typeof (payload.result ?? run.result) === 'string'
        ? String(payload.result ?? run.result)
        : JSON.stringify(payload.result ?? run.result ?? {}, null, 2);

    const replyToJid =
      (isWhatsAppContactJid(target.peerId) ? target.peerId : null) ??
      run.whatsappReplyToJid ??
      null;

    const { deliverRunResultToWhatsAppIfRequested } = await import(
      '../../whatsapp/whatsappChannel.service.js'
    );

    await deliverRunResultToWhatsAppIfRequested({
      orgId,
      title: run.agent?.name ?? payload.agentName ?? 'Qlix',
      body: body.slice(0, 3500),
      sourceText: run.prompt,
      fromWhatsAppChannel,
      agentDescription: run.agent?.description ?? null,
      success: payload.ok,
      errorMessage: payload.errorMessage ?? run.errorMessage,
      replyToJid,
      connectorId: target.connectorId ?? null,
      runId: payload.runId,
    });
  },
};

export function buildWhatsAppInbound(input: {
  connectorId: string;
  orgId: string;
  userId: string;
  peerId?: string;
  body: string;
  useBrain?: boolean;
  inferenceModel?: string | null;
  /** Contact JID when this turn should reply to a contact (auto-reply). */
  whatsappReplyToJid?: string | null;
  preResolved: NonNullable<InboundMessage['preResolved']>;
}): InboundMessage {
  const contactPeer = input.whatsappReplyToJid?.trim() || null;
  return {
    channel: 'whatsapp',
    orgId: input.orgId,
    userId: input.userId,
    peerId: contactPeer ?? input.peerId ?? input.connectorId,
    body: input.body,
    useBrain: input.useBrain,
    inferenceModel: input.inferenceModel ?? null,
    deliveryTarget: {
      channel: 'whatsapp',
      connectorId: input.connectorId,
      peerId: contactPeer ?? input.peerId ?? input.connectorId,
    },
    metadata: contactPeer ? { whatsappReplyToJid: contactPeer } : undefined,
    preResolved: {
      ...input.preResolved,
      teamRole: input.preResolved.teamRole ?? 'whatsapp',
    },
  };
}
