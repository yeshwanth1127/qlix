/**
 * Multi-conversation helpers for agent chat (web + local terminal).
 * Primary = oldest conversation for (agentId, userId); local /new and /fork create siblings.
 */

import { prisma } from '../lib/prisma.js';

/** Create an isolated conversation for a gateway peer/thread. */
export async function getOrCreateGatewayConversation(params: {
  agentId: string;
  userId: string;
  orgId: string | null;
  sessionKey: string;
  title?: string | null;
}): Promise<{ id: string; createdAt: Date; title: string | null; kind: string }> {
  const existing = await prisma.agentConversation.findFirst({
    where: { agentId: params.agentId, userId: params.userId, sessionKey: params.sessionKey },
    select: { id: true, createdAt: true, title: true, kind: true },
  });
  if (existing) return existing;

  return prisma.agentConversation.create({
    data: {
      agentId: params.agentId,
      userId: params.userId,
      orgId: params.orgId,
      kind: 'gateway',
      title: params.title?.trim() || 'Slack conversation',
      sessionKey: params.sessionKey,
    },
    select: { id: true, createdAt: true, title: true, kind: true },
  });
}

export async function getOrCreatePrimaryConversation(params: {
  agentId: string;
  userId: string;
  orgId: string | null;
}): Promise<{ id: string; createdAt: Date; title: string | null; kind: string }> {
  const existing = await prisma.agentConversation.findFirst({
    // `kind: 'chat'` matters: without it this returns the oldest conversation of ANY kind, so an
    // agent first used from the Visual Builder (or a gateway channel) would adopt that thread as
    // its direct chat — mixing machine-to-machine turns into the user's own conversation.
    where: { agentId: params.agentId, userId: params.userId, kind: 'chat' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true, title: true, kind: true },
  });
  if (existing) return existing;

  const created = await prisma.agentConversation.create({
    data: {
      agentId: params.agentId,
      userId: params.userId,
      orgId: params.orgId,
      kind: 'chat',
      title: 'Chat',
    },
    select: { id: true, createdAt: true, title: true, kind: true },
  });
  return created;
}

/** `sessionKey` value grouping every participant's thread for one Visual Builder canvas. */
export function builderSessionKey(canvasId: string): string {
  return `builder:${canvasId}`;
}

/**
 * The thread an agent uses for Visual Builder work — its own canvas-scoped conversation,
 * never its direct chat.
 *
 * Keeping builder traffic in a separate `AgentConversation` row is what stops it reaching the
 * agent's direct-chat context: `buildMemoryBlock` and `updateConversationSummary` are both
 * scoped by `conversationId`, so the working window and the rolling summary of the direct chat
 * physically cannot see these turns. That is a structural guarantee rather than a filter
 * somebody has to remember to apply.
 */
export async function getOrCreateBuilderConversation(params: {
  agentId: string;
  userId: string;
  orgId: string | null;
  canvasId: string;
  /** Shown in the agent's conversation list, e.g. "Visual Builder · asked by Researcher". */
  title?: string | null;
}): Promise<{ id: string; createdAt: Date; title: string | null; kind: string }> {
  const sessionKey = builderSessionKey(params.canvasId);
  const existing = await prisma.agentConversation.findFirst({
    where: { agentId: params.agentId, userId: params.userId, kind: 'builder', sessionKey },
    select: { id: true, createdAt: true, title: true, kind: true },
  });
  if (existing) return existing;

  return prisma.agentConversation.create({
    data: {
      agentId: params.agentId,
      userId: params.userId,
      orgId: params.orgId,
      kind: 'builder',
      title: params.title?.trim() || 'Visual Builder',
      sessionKey,
    },
    select: { id: true, createdAt: true, title: true, kind: true },
  });
}

/** Every participating agent's thread for one canvas, for the builder chat transcript. */
export async function listBuilderConversations(params: {
  userId: string;
  canvasId: string;
}): Promise<Array<{ id: string; agentId: string; title: string | null }>> {
  return prisma.agentConversation.findMany({
    where: {
      userId: params.userId,
      kind: 'builder',
      sessionKey: builderSessionKey(params.canvasId),
    },
    select: { id: true, agentId: true, title: true },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * The thread a target agent uses for work handed to it by another agent, outside any canvas.
 *
 * One thread per calling agent (`peer:<callerAgentId>`), so B's conversation list reads as a set
 * of labelled inboxes — "Asked by Researcher" — rather than one undifferentiated pile. Like
 * builder threads, this is deliberately not `kind: 'chat'`, which is what keeps it out of B's
 * direct-chat summary and working context.
 */
export async function getOrCreatePeerConversation(params: {
  agentId: string;
  userId: string;
  orgId: string | null;
  callerAgentId: string;
  callerName: string;
}): Promise<{ id: string; createdAt: Date; title: string | null; kind: string }> {
  const sessionKey = `peer:${params.callerAgentId}`;
  const existing = await prisma.agentConversation.findFirst({
    where: { agentId: params.agentId, userId: params.userId, kind: 'peer', sessionKey },
    select: { id: true, createdAt: true, title: true, kind: true },
  });
  if (existing) return existing;

  return prisma.agentConversation.create({
    data: {
      agentId: params.agentId,
      userId: params.userId,
      orgId: params.orgId,
      kind: 'peer',
      title: `Asked by ${params.callerName}`,
      sessionKey,
    },
    select: { id: true, createdAt: true, title: true, kind: true },
  });
}

export async function ensureLocalConversation(params: {
  agentId: string;
  userId: string;
  orgId: string | null;
  conversationId?: string | null;
}): Promise<string> {
  if (params.conversationId) {
    const row = await prisma.agentConversation.findFirst({
      where: {
        id: params.conversationId,
        agentId: params.agentId,
        userId: params.userId,
      },
      select: { id: true },
    });
    if (!row) {
      throw Object.assign(new Error('Conversation not found'), {
        code: 'conversation_not_found',
        status: 404,
      });
    }
    await prisma.agentConversation
      .update({ where: { id: row.id }, data: { updatedAt: new Date() } })
      .catch(() => undefined);
    return row.id;
  }

  // Prefer most recently updated local thread; else primary chat.
  const local = await prisma.agentConversation.findFirst({
    where: { agentId: params.agentId, userId: params.userId, kind: 'local' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  if (local) return local.id;

  const primary = await getOrCreatePrimaryConversation(params);
  return primary.id;
}

export async function createLocalConversation(params: {
  agentId: string;
  userId: string;
  orgId: string | null;
  title?: string | null;
  parentConversationId?: string | null;
}): Promise<{ id: string; title: string; kind: string; parentConversationId: string | null }> {
  const title =
    (params.title && params.title.trim()) ||
    `Local ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

  if (params.parentConversationId) {
    const parent = await prisma.agentConversation.findFirst({
      where: {
        id: params.parentConversationId,
        agentId: params.agentId,
        userId: params.userId,
      },
      select: { id: true },
    });
    if (!parent) {
      throw Object.assign(new Error('Parent conversation not found'), {
        code: 'conversation_not_found',
        status: 404,
      });
    }
  }

  const created = await prisma.agentConversation.create({
    data: {
      agentId: params.agentId,
      userId: params.userId,
      orgId: params.orgId,
      kind: 'local',
      title,
      parentConversationId: params.parentConversationId ?? null,
      sessionKey: `local:${params.agentId}:${params.userId}:${Date.now()}`,
    },
    select: { id: true, title: true, kind: true, parentConversationId: true },
  });
  return {
    id: created.id,
    title: created.title ?? title,
    kind: created.kind,
    parentConversationId: created.parentConversationId,
  };
}

export async function forkConversation(params: {
  agentId: string;
  userId: string;
  orgId: string | null;
  sourceConversationId: string;
  title?: string | null;
}): Promise<{ id: string; title: string; messageCount: number }> {
  const source = await prisma.agentConversation.findFirst({
    where: {
      id: params.sourceConversationId,
      agentId: params.agentId,
      userId: params.userId,
    },
    select: { id: true, title: true, summary: true, summarizedCount: true },
  });
  if (!source) {
    throw Object.assign(new Error('Conversation not found'), {
      code: 'conversation_not_found',
      status: 404,
    });
  }

  const messages = await prisma.agentMessage.findMany({
    where: { conversationId: source.id },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: { role: true, content: true, attachments: true, createdAt: true },
  });

  const title =
    (params.title && params.title.trim()) ||
    `Fork of ${source.title ?? 'chat'} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

  const created = await prisma.$transaction(async (tx) => {
    const convo = await tx.agentConversation.create({
      data: {
        agentId: params.agentId,
        userId: params.userId,
        orgId: params.orgId,
        kind: 'local',
        title,
        parentConversationId: source.id,
        summary: source.summary,
        summarizedCount: source.summarizedCount,
        sessionKey: `local:${params.agentId}:${params.userId}:fork:${Date.now()}`,
      },
      select: { id: true, title: true },
    });
    if (messages.length > 0) {
      await tx.agentMessage.createMany({
        data: messages.map((m) => ({
          conversationId: convo.id,
          role: m.role,
          content: m.content,
          attachments: m.attachments ?? undefined,
          createdAt: m.createdAt,
        })),
      });
    }
    return convo;
  });

  return {
    id: created.id,
    title: created.title ?? title,
    messageCount: messages.length,
  };
}

export async function listConversationsForAgent(params: {
  agentId: string;
  userId: string;
}): Promise<
  Array<{
    id: string;
    title: string | null;
    kind: string;
    parentConversationId: string | null;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
  }>
> {
  const rows = await prisma.agentConversation.findMany({
    where: { agentId: params.agentId, userId: params.userId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      kind: true,
      parentConversationId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    parentConversationId: r.parentConversationId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    messageCount: r._count.messages,
  }));
}
