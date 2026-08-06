import type { ChannelAdapter, DeliveryTarget, ReplyPayload } from '../types.js';

/**
 * Local terminal chat adapter — replies land via AgentMessage + runner SSE.
 * Delivery is a no-op (same pattern as web chat).
 */
export const localAdapter: ChannelAdapter = {
  channel: 'local',
  async deliver(_target: DeliveryTarget, _payload: ReplyPayload): Promise<void> {
    // Final assistant message is written in runs/:runId/complete.
    // Local TTY streams AgentRunEvent via runner-auth SSE.
  },
};

export function buildLocalInbound(input: {
  agentId: string;
  conversationId: string;
  userId: string;
  orgId: string | null;
  email?: string;
  body: string;
  displayBody?: string;
  agentName?: string;
}): import('../types.js').InboundMessage {
  return {
    channel: 'local',
    orgId: input.orgId,
    userId: input.userId,
    email: input.email,
    peerId: input.userId,
    threadId: input.conversationId,
    body: input.body,
    displayBody: input.displayBody,
    deliveryTarget: {
      channel: 'local',
      peerId: input.userId,
      threadId: input.conversationId,
      label: 'Local terminal',
    },
    preResolved: {
      targetType: 'agent',
      agentId: input.agentId,
      conversationId: input.conversationId,
      orgId: input.orgId,
      userId: input.userId,
      targetName: input.agentName,
      teamRole: null,
    },
    metadata: { channel: 'local' },
  };
}
