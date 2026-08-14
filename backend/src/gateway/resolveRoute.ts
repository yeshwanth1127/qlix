import { prisma } from '../lib/prisma.js';
import { buildSessionKeyFromInbound } from './sessionKey.js';
import type { InboundMessage, ResolvedRoute } from './types.js';

export class GatewayRouteError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'route_failed',
  ) {
    super(message);
    this.name = 'GatewayRouteError';
  }
}

/**
 * Map an inbound message to an agent or team target.
 * Web chat usually supplies preResolved; WhatsApp/Slack use intent + defaults.
 */
export async function resolveRoute(
  msg: InboundMessage,
  sessionKey?: string,
): Promise<ResolvedRoute> {
  const key = sessionKey ?? buildSessionKeyFromInbound(msg);
  const pre = msg.preResolved;

  if (pre?.targetType === 'team' && pre.teamId) {
    return {
      targetType: 'team',
      teamId: pre.teamId,
      orgId: pre.orgId ?? msg.orgId,
      userId: pre.userId ?? msg.userId,
      targetName: pre.targetName,
      teamRole: pre.teamRole ?? channelTeamRole(msg.channel),
      routeHint: pre.routeHint,
      sessionKey: key,
    };
  }

  if (pre?.agentId) {
    let conversationId = pre.conversationId;
    if (!conversationId) {
      conversationId = await ensureConversation(pre.agentId, msg.userId, msg.orgId);
    }
    return {
      targetType: 'agent',
      agentId: pre.agentId,
      conversationId,
      orgId: pre.orgId ?? msg.orgId,
      userId: pre.userId ?? msg.userId,
      targetName: pre.targetName,
      teamRole: pre.teamRole ?? channelTeamRole(msg.channel),
      routeHint: pre.routeHint,
      sessionKey: key,
    };
  }

  // Metadata-driven team route (@Team)
  const teamId = typeof msg.metadata?.teamId === 'string' ? msg.metadata.teamId : null;
  if (teamId) {
    return {
      targetType: 'team',
      teamId,
      orgId: msg.orgId,
      userId: msg.userId,
      targetName: typeof msg.metadata?.teamName === 'string' ? msg.metadata.teamName : undefined,
      teamRole: channelTeamRole(msg.channel),
      sessionKey: key,
    };
  }

  throw new GatewayRouteError(
    'Unable to resolve agent or team for inbound message',
    'unresolved_route',
  );
}

function channelTeamRole(channel: InboundMessage['channel']): string | null {
  if (channel === 'web' || channel === 'api' || channel === 'system' || channel === 'cron' || channel === 'local') {
    return null;
  }
  return channel;
}

async function ensureConversation(
  agentId: string,
  userId: string,
  orgId: string | null,
): Promise<string> {
  const { getOrCreatePrimaryConversation } = await import('../agentChat/conversationService.js');
  const convo = await getOrCreatePrimaryConversation({ agentId, userId, orgId });
  return convo.id;
}
