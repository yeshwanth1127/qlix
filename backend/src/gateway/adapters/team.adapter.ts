import type { InboundMessage } from '../types.js';

/**
 * Build a gateway inbound for an @Team goal (web or WhatsApp).
 */
export function buildTeamInbound(input: {
  channel: 'web' | 'whatsapp' | 'slack' | 'telegram';
  teamId: string;
  teamName: string;
  orgId: string;
  userId: string;
  email?: string;
  goal: string;
  connectorId?: string;
  peerId?: string;
  backendUrl?: string;
  /** Optional per-run model override (wired into team.config.defaultModel for this execution). */
  inferenceModel?: string | null;
}): InboundMessage {
  return {
    channel: input.channel,
    orgId: input.orgId,
    userId: input.userId,
    email: input.email,
    peerId: input.peerId ?? input.userId,
    body: input.goal,
    deliveryTarget: {
      channel: input.channel,
      connectorId: input.connectorId ?? null,
      peerId: input.peerId ?? input.userId,
      label: input.teamName,
    },
    preResolved: {
      targetType: 'team',
      teamId: input.teamId,
      targetName: input.teamName,
      orgId: input.orgId,
      userId: input.userId,
      teamRole: input.channel === 'web' ? null : input.channel,
    },
    metadata: {
      teamId: input.teamId,
      teamName: input.teamName,
      ...(input.backendUrl ? { backendUrl: input.backendUrl } : {}),
      ...(input.inferenceModel ? { inferenceModel: input.inferenceModel } : {}),
    },
  };
}
