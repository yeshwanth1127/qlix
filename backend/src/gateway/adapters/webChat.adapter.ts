import type { ChannelAdapter, DeliveryTarget, ReplyPayload } from '../types.js';

/**
 * Web chat adapter — replies already land via AgentMessage + SSE/poll.
 * Delivery is a no-op for final text; tracking still enables gateway audit.
 */
export const webChatAdapter: ChannelAdapter = {
  channel: 'web',
  async deliver(_target: DeliveryTarget, _payload: ReplyPayload): Promise<void> {
    // Final assistant message is written in runs/:runId/complete.
    // UI streams AgentRunEvent / conversation messages.
  },
};

export function buildWebChatInbound(input: {
  agentId: string;
  conversationId: string;
  userId: string;
  orgId: string | null;
  email?: string;
  body: string;
  displayBody?: string;
  attachments?: InboundAttachments;
  skills?: string[];
  inferenceModel?: string | null;
  useBrain?: boolean;
  agentName?: string;
}): import('../types.js').InboundMessage {
  return {
    channel: 'web',
    orgId: input.orgId,
    userId: input.userId,
    email: input.email,
    peerId: input.userId,
    threadId: input.conversationId,
    body: input.body,
    displayBody: input.displayBody,
    attachments: input.attachments,
    skills: input.skills,
    inferenceModel: input.inferenceModel,
    useBrain: input.useBrain,
    deliveryTarget: {
      channel: 'web',
      peerId: input.userId,
      threadId: input.conversationId,
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
  };
}

type InboundAttachments = import('../types.js').InboundAttachment[];
