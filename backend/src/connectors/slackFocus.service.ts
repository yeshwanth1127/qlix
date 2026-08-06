import { prisma } from '../lib/prisma.js';

export interface SlackFocus {
  channel: string;
  channelId?: string | null;
  listId: string;
  listTitle?: string | null;
  itemId?: string | null;
  taskTitle?: string | null;
  status?: string | null;
}

const PREFIX = 'slack-focus:';

/**
 * Keeps compact, per-conversation operational context out of user-memory extraction.
 * The latest focus is injected into the next run in the same Slack thread.
 */
export async function saveSlackFocus(params: {
  agentId: string;
  runId?: string | null;
  focus: SlackFocus;
}): Promise<void> {
  if (!params.runId) return;
  const run = await prisma.agentRun.findFirst({
    where: { id: params.runId, agentId: params.agentId },
    select: { conversationId: true },
  });
  if (!run?.conversationId) return;
  const conversation = await prisma.agentConversation.findUnique({
    where: { id: run.conversationId },
    select: { userId: true, orgId: true },
  });
  if (!conversation) return;

  const source = `${PREFIX}${run.conversationId}`;
  await prisma.agentMemory.deleteMany({
    where: { agentId: params.agentId, userId: conversation.userId, source },
  });
  await prisma.agentMemory.create({
    data: {
      agentId: params.agentId,
      userId: conversation.userId,
      orgId: conversation.orgId,
      kind: 'operational',
      source,
      content: JSON.stringify(params.focus),
    },
  });
}

export async function loadSlackFocus(params: {
  agentId: string;
  userId: string;
  conversationId: string;
}): Promise<SlackFocus | null> {
  const row = await prisma.agentMemory.findFirst({
    where: {
      agentId: params.agentId,
      userId: params.userId,
      kind: 'operational',
      source: `${PREFIX}${params.conversationId}`,
    },
    orderBy: { createdAt: 'desc' },
    select: { content: true },
  });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.content) as SlackFocus;
    return parsed && typeof parsed.channel === 'string' && typeof parsed.listId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}
