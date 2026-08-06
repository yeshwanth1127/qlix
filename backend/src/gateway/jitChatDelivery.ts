import type { DeliveryTarget } from './types.js';
import { deliverSlackJitApproval } from './adapters/slack.adapter.js';
import { replyDispatcher } from './replyDispatcher.js';

/**
 * Deliver JIT approval prompts to chat channels (WhatsApp / Slack).
 * Hermes-style approval cards in the conversation the agent was messaged from.
 */
export async function deliverJitApprovalToChat(input: {
  runId?: string | null;
  deliveryTarget?: DeliveryTarget | null;
  orgId: string;
  actionType: string;
  actionLogId: string;
  agentName: string;
  context: string;
}): Promise<{ channel: string; sent: boolean }> {
  const pending = input.runId ? replyDispatcher.getPending(input.runId) : undefined;
  const target = input.deliveryTarget ?? pending?.deliveryTarget ?? null;

  if (target?.channel === 'slack' && target.peerId) {
    const sent = await deliverSlackJitApproval({
      channelId: target.peerId,
      threadTs: target.threadId,
      actionType: input.actionType,
      jitRequestId: input.actionLogId,
      agentName: input.agentName,
    });
    return { channel: 'slack', sent };
  }

  try {
    const { isWhatsAppJitEnabled, sendApproval } = await import('../jit/whatsappNotifier.js');
    if (!isWhatsAppJitEnabled()) {
      return { channel: 'whatsapp', sent: false };
    }
    const { getConnectedWhatsAppForOrg } = await import('../connectors/whatsappConnector.service.js');
    const connectorId = target?.connectorId;
    let resolvedConnectorId = connectorId ?? null;
    if (!resolvedConnectorId) {
      const connector = await getConnectedWhatsAppForOrg(input.orgId);
      resolvedConnectorId = connector?.id ?? null;
    }
    if (!resolvedConnectorId) return { channel: 'whatsapp', sent: false };

    const sent = await sendApproval({
      connector_id: resolvedConnectorId,
      action_id: input.actionLogId,
      agent_name: input.agentName,
      scope: input.actionType,
      context: input.context,
    });
    return { channel: 'whatsapp', sent: sent.ok };
  } catch (err) {
    console.warn('[jit-chat] deliver failed', err instanceof Error ? err.message : err);
    return { channel: 'whatsapp', sent: false };
  }
}
