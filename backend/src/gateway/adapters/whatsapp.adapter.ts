import { prisma } from '../../lib/prisma.js';
import type { ChannelAdapter, DeliveryTarget, InboundMessage, ReplyPayload } from '../types.js';

/**
 * WhatsApp channel adapter — delivery via existing notifier; inbound builders
 * normalize sidecar text into gateway InboundMessage.
 */
export const whatsappAdapter: ChannelAdapter = {
  channel: 'whatsapp',
  async deliver(_target: DeliveryTarget, payload: ReplyPayload): Promise<void> {
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
  preResolved: NonNullable<InboundMessage['preResolved']>;
}): InboundMessage {
  return {
    channel: 'whatsapp',
    orgId: input.orgId,
    userId: input.userId,
    peerId: input.peerId ?? input.connectorId,
    body: input.body,
    useBrain: input.useBrain,
    deliveryTarget: {
      channel: 'whatsapp',
      connectorId: input.connectorId,
      peerId: input.peerId ?? input.connectorId,
    },
    preResolved: {
      ...input.preResolved,
      teamRole: input.preResolved.teamRole ?? 'whatsapp',
    },
  };
}
