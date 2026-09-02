import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { ConversationOwnerType } from './conversation.types.js';
import { startConversation, signalConversation } from './conversationEngine.service.js';
import { createConversationProcess } from './conversationProcess.service.js';
import { conversationPluginRegistry } from './registry.js';
import { fallbackPromptFromContent, type ConversationPrompt } from './conversationPrompt.js';
import { OUTREACH_CONVERSATION_WORKFLOW_KEY } from './outreachConversationWorkflow.js';
import { ensureOutreachConversationWorkflow } from './ensureOutreachConversationWorkflow.js';
import { attachTrace, createTraceEnvelope } from '../contracts/traceEnvelope.js';

export type ConversationRecipient = {
  address: string;
  displayName?: string | null;
  connectorId?: string | null;
};

export type ConversationThreadSummary = {
  id: string;
  processId: string | null;
  status: string;
  channel: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  participant: {
    role: string;
    address: string | null;
    displayName: string | null;
    channel: string | null;
  } | null;
  lastInbound: { text: string; occurredAt: string } | null;
  lastOutbound: { text: string; occurredAt: string } | null;
  eventCount: number;
};

export type StartedConversationThread = {
  threadId: string;
  recipient: string;
  status: string;
};

async function ensureProcess(input: {
  orgId: string;
  ownerType: ConversationOwnerType;
  ownerId?: string | null;
  externalRefType?: string | null;
  externalRefId?: string | null;
  completionMode?: 'all_terminal' | 'all_terminal_or_timeout' | 'first_success' | 'manual' | 'continuous';
  metadata?: Record<string, unknown>;
}): Promise<string> {
  if (input.externalRefType && input.externalRefId) {
    const existing = await prisma.conversationProcess.findUnique({
      where: {
        orgId_externalRefType_externalRefId: {
          orgId: input.orgId,
          externalRefType: input.externalRefType,
          externalRefId: input.externalRefId,
        },
      },
      select: { id: true },
    });
    if (existing) return existing.id;
  }
  const created = await createConversationProcess(input);
  return created.id;
}

function eventText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.text === 'string' && row.text.trim()) return row.text;
  if (typeof row.content === 'string' && row.content.trim()) return row.content;
  const inbound = row.inbound;
  if (inbound && typeof inbound === 'object') {
    const text = (inbound as { text?: unknown }).text;
    if (typeof text === 'string' && text.trim()) return text;
  }
  return null;
}

export async function listConversationThreads(input: {
  orgId: string;
  processId?: string | null;
  ownerType?: string | null;
  ownerId?: string | null;
  threadId?: string | null;
}): Promise<{ processId: string | null; threads: ConversationThreadSummary[] }> {
  const where: Prisma.ConversationThreadWhereInput = { orgId: input.orgId };
  if (input.threadId) where.id = input.threadId;
  if (input.processId) where.processId = input.processId;
  if (input.ownerType) where.ownerType = input.ownerType;
  if (input.ownerId) where.ownerId = input.ownerId;

  const threads = await prisma.conversationThread.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      processId: true,
      status: true,
      channel: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
    },
  });
  if (threads.length === 0) {
    return { processId: input.processId ?? null, threads: [] };
  }

  const threadIds = threads.map((thread) => thread.id);
  const [participants, events] = await Promise.all([
    prisma.conversationParticipant.findMany({
      where: { threadId: { in: threadIds }, role: 'contact' },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.conversationEvent.findMany({
      where: { threadId: { in: threadIds } },
      orderBy: { seq: 'asc' },
      select: {
        threadId: true,
        eventType: true,
        direction: true,
        payload: true,
        occurredAt: true,
      },
    }),
  ]);

  const participantByThread = new Map<string, (typeof participants)[number]>();
  for (const participant of participants) {
    if (!participantByThread.has(participant.threadId)) {
      participantByThread.set(participant.threadId, participant);
    }
  }

  const lastInbound = new Map<string, { text: string; occurredAt: Date }>();
  const lastOutbound = new Map<string, { text: string; occurredAt: Date }>();
  const eventCounts = new Map<string, number>();
  for (const event of events) {
    eventCounts.set(event.threadId, (eventCounts.get(event.threadId) ?? 0) + 1);
    const text = eventText(event.payload);
    if (!text) continue;
    if (event.direction === 'inbound' || event.eventType === 'inbound_received') {
      lastInbound.set(event.threadId, { text, occurredAt: event.occurredAt });
    }
    if (event.direction === 'outbound' || event.eventType === 'outbound_sent' || event.eventType === 'outbound_requested') {
      lastOutbound.set(event.threadId, { text, occurredAt: event.occurredAt });
    }
  }

  return {
    processId: threads[0]?.processId ?? input.processId ?? null,
    threads: threads.map((thread) => {
      const participant = participantByThread.get(thread.id);
      const inbound = lastInbound.get(thread.id);
      const outbound = lastOutbound.get(thread.id);
      return {
        id: thread.id,
        processId: thread.processId,
        status: thread.status,
        channel: thread.channel,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
        completedAt: thread.completedAt?.toISOString() ?? null,
        participant: participant
          ? {
              role: participant.role,
              address: participant.address,
              displayName: participant.displayName,
              channel: participant.channel,
            }
          : null,
        lastInbound: inbound
          ? { text: inbound.text, occurredAt: inbound.occurredAt.toISOString() }
          : null,
        lastOutbound: outbound
          ? { text: outbound.text, occurredAt: outbound.occurredAt.toISOString() }
          : null,
        eventCount: eventCounts.get(thread.id) ?? 0,
      };
    }),
  };
}

export async function getConversationThreadDetail(input: {
  orgId: string;
  threadId: string;
}): Promise<{
  thread: ConversationThreadSummary;
  events: Array<{
    id: string;
    seq: number;
    eventType: string;
    direction: string | null;
    payload: unknown;
    occurredAt: string;
  }>;
} | null> {
  const listed = await listConversationThreads({
    orgId: input.orgId,
    threadId: input.threadId,
  });
  const summary = listed.threads.find((thread) => thread.id === input.threadId);
  if (!summary) return null;
  const events = await prisma.conversationEvent.findMany({
    where: { threadId: input.threadId },
    orderBy: { seq: 'asc' },
  });
  return {
    thread: summary,
    events: events.map((event) => ({
      id: event.id,
      seq: event.seq,
      eventType: event.eventType,
      direction: event.direction,
      payload: event.payload,
      occurredAt: event.occurredAt.toISOString(),
    })),
  };
}

export async function findActiveThreadForBinding(input: {
  orgId: string;
  channel: string;
  keyValue: string;
  connectorId?: string | null;
}): Promise<string | null> {
  const binding = await prisma.conversationBinding.findFirst({
    where: {
      orgId: input.orgId,
      channel: input.channel,
      keyValue: input.keyValue,
      active: true,
      ...(input.connectorId ? { connectorId: input.connectorId } : {}),
    },
    select: { threadId: true },
    orderBy: { priority: 'desc' },
  });
  return binding?.threadId ?? null;
}

export async function startOutreachConversations(input: {
  orgId: string;
  ownerType: ConversationOwnerType;
  ownerId?: string | null;
  processId?: string | null;
  channel: string;
  recipients: ConversationRecipient[];
  openingMessage?: string | null;
  prompt?: ConversationPrompt;
  workflowVersionId?: string | null;
  agentId?: string | null;
  teamRunId?: string | null;
  expiresAt?: Date | null;
  externalRefType?: string | null;
  externalRefId?: string | null;
}): Promise<{ processId: string; threads: StartedConversationThread[] }> {
  await ensureOutreachConversationWorkflow();
  const openingMessage = (input.openingMessage ?? '').trim();
  const processId =
    input.processId ??
    (await ensureProcess({
      orgId: input.orgId,
      ownerType: input.ownerType,
      ownerId: input.ownerId ?? input.teamRunId ?? input.agentId ?? null,
      externalRefType: input.externalRefType ?? (input.teamRunId ? 'team_run' : null),
      externalRefId: input.externalRefId ?? input.teamRunId ?? null,
      completionMode: 'all_terminal_or_timeout',
      metadata: { source: 'outreach' },
    }));

  const threads: StartedConversationThread[] = [];
  for (const recipient of input.recipients) {
    const address = recipient.address.trim();
    if (!address) continue;
    const existing = await findActiveThreadForBinding({
      orgId: input.orgId,
      channel: input.channel,
      keyValue: address,
      connectorId: recipient.connectorId,
    });
    if (existing) {
      const thread = await prisma.conversationThread.findUnique({
        where: { id: existing },
        select: { status: true },
      });
      threads.push({ threadId: existing, recipient: address, status: thread?.status ?? 'active' });
      continue;
    }
    const started = await startConversation({
      orgId: input.orgId,
      processId,
      ownerType: input.ownerType,
      ownerId: input.ownerId ?? input.teamRunId ?? input.agentId ?? null,
      channel: input.channel,
      workflowVersionId: input.workflowVersionId ?? undefined,
      workflowKey: input.workflowVersionId ? undefined : OUTREACH_CONVERSATION_WORKFLOW_KEY,
      variables: {
        openingMessage,
        orgId: input.orgId,
        channel: input.channel,
        ...(input.teamRunId ? { teamRunId: input.teamRunId } : {}),
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(recipient.connectorId ? { connectorId: recipient.connectorId } : {}),
        contactAddress: address,
      },
      participants: [
        {
          role: 'contact',
          channel: input.channel,
          address,
          displayName: recipient.displayName ?? null,
        },
      ],
      bindings: [
        {
          channel: input.channel,
          connectorId: recipient.connectorId ?? null,
          keyType: 'participant_address',
          keyValue: address,
          priority: 10,
          expiresAt: input.expiresAt ?? null,
        },
      ],
    });
    const thread = await prisma.conversationThread.findUnique({
      where: { id: started.threadId },
      select: { status: true },
    });
    threads.push({
      threadId: started.threadId,
      recipient: address,
      status: thread?.status ?? 'waiting_input',
    });
  }
  return { processId, threads };
}

export async function sendOnConversationThread(input: {
  orgId: string;
  threadId: string;
  content: string;
  prompt?: ConversationPrompt;
}): Promise<{ ok: true }> {
  const thread = await prisma.conversationThread.findFirst({
    where: { id: input.threadId, orgId: input.orgId },
    select: { id: true, channel: true, version: true, processId: true, orgId: true },
  });
  if (!thread) throw new Error('Conversation thread was not found');
  const channel = thread.channel;
  if (!channel) throw new Error('Conversation thread has no channel');
  const prompt = input.prompt ?? fallbackPromptFromContent(input.content, null);
  const idempotencyKey = `${thread.id}:manual-send:${thread.version + 1}`;
  await conversationPluginRegistry.deliverSend(
    channel,
    { orgId: input.orgId, threadId: thread.id, idempotencyKey },
    { content: prompt.content, prompt },
  );
  const nextVersion = thread.version + 1;
  await prisma.$transaction(async (tx) => {
    const updated = await tx.conversationThread.updateMany({
      where: { id: thread.id, version: thread.version },
      data: { version: nextVersion },
    });
    if (updated.count !== 1) return;
    await tx.conversationEvent.create({
      data: {
        orgId: thread.orgId,
        threadId: thread.id,
        seq: nextVersion,
        eventType: 'outbound_sent',
        direction: 'outbound',
        channel,
        idempotencyKey,
        payload: attachTrace(
          { content: prompt.content, prompt },
          createTraceEnvelope({
            traceId: thread.processId ?? thread.id,
            spanId: `conversation:${thread.id}:${nextVersion}`,
            parentSpanId: thread.processId ?? thread.id,
            executionId: thread.id,
            executionKind: 'conversation',
            orgId: thread.orgId,
          }),
        ) as Prisma.InputJsonValue,
      },
    });
  });
  return { ok: true };
}

export async function closeConversationThread(input: {
  orgId: string;
  threadId: string;
  reason?: string;
}): Promise<{ status: string }> {
  const thread = await prisma.conversationThread.findFirst({
    where: { id: input.threadId, orgId: input.orgId },
    select: { id: true, status: true },
  });
  if (!thread) throw new Error('Conversation thread was not found');
  if (['completed', 'failed', 'canceled', 'expired', 'handed_off'].includes(thread.status)) {
    return { status: thread.status };
  }
  const result = await signalConversation({
    threadId: thread.id,
    signal: { type: 'cancel', reason: input.reason ?? 'closed' },
    idempotencyKey: `${thread.id}:cancel:${Date.now()}`,
  });
  await prisma.conversationBinding.updateMany({
    where: { threadId: thread.id },
    data: { active: false },
  });
  return { status: result.status };
}
