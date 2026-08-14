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
  reasoningEffort?: string | null;
  useBrain?: boolean;
  agentName?: string;
  /** Origin of this turn. Console chat is `web`; Developer API keys are `api`. */
  channel?: import('../types.js').GatewayChannel;
}): import('../types.js').InboundMessage {
  const channel = input.channel ?? 'web';
  return {
    channel,
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
    reasoningEffort: input.reasoningEffort,
    useBrain: input.useBrain,
    deliveryTarget: {
      channel,
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
