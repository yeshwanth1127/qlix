import { prisma } from '../lib/prisma.js';

export type InboundCorrelation = {
  orgId: string;
  channel: string;
  connectorId?: string | null;
  replyToProviderMessageId?: string | null;
  externalThreadId?: string | null;
  participantAddress?: string | null;
  workflowKey?: string | null;
};

export type CorrelationResult =
  | { status: 'matched'; threadId: string; matchedBy: string }
  | { status: 'unmatched' }
  | { status: 'ambiguous'; threadIds: string[]; matchedBy: string };

type CorrelationCandidate = { keyType: string; keyValue: string };

function candidates(input: InboundCorrelation): CorrelationCandidate[] {
  const values: CorrelationCandidate[] = [];
  if (input.replyToProviderMessageId) {
    values.push({ keyType: 'reply_to_message', keyValue: input.replyToProviderMessageId });
  }
  if (input.externalThreadId) {
    values.push({ keyType: 'external_thread', keyValue: input.externalThreadId });
  }
  if (input.participantAddress && input.workflowKey) {
    values.push({
      keyType: 'participant_workflow',
      keyValue: `${input.participantAddress}:${input.workflowKey}`,
    });
  }
  if (input.participantAddress) {
    values.push({ keyType: 'participant_address', keyValue: input.participantAddress });
  }
  return values;
}

/**
 * Resolve one inbound event without guessing. Candidate types are tried in strict
 * precedence order; multiple active matches at the same precedence fail closed.
 */
export async function correlateInboundConversation(
  input: InboundCorrelation,
): Promise<CorrelationResult> {
  const now = new Date();
  for (const candidate of candidates(input)) {
    const matches = await prisma.conversationBinding.findMany({
      where: {
        orgId: input.orgId,
        channel: input.channel,
        connectorId: input.connectorId ?? null,
        keyType: candidate.keyType,
        keyValue: candidate.keyValue,
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { threadId: true },
      distinct: ['threadId'],
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 3,
    });
    if (matches.length === 1) {
      return { status: 'matched', threadId: matches[0]!.threadId, matchedBy: candidate.keyType };
    }
    if (matches.length > 1) {
      return {
        status: 'ambiguous',
        threadIds: matches.map((match) => match.threadId),
        matchedBy: candidate.keyType,
      };
    }
  }
  return { status: 'unmatched' };
}

