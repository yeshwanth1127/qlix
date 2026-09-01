import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type {
  ConversationEffect,
  ConversationOwnerType,
  ConversationRuntimeState,
  ConversationSignal,
} from './conversation.types.js';
import { createInitialConversationState, transitionConversation } from './conversationRuntime.js';
import type { ConversationWorkflow } from './workflow.types.js';
import { compileConversationWorkflow } from './workflowCompiler.js';
import { loadPublishedWorkflow } from './conversationWorkflow.service.js';
import { attachTrace, createTraceEnvelope } from '../contracts/traceEnvelope.js';

export class ConversationVersionConflictError extends Error {
  constructor() {
    super('Conversation changed while this event was being applied');
    this.name = 'ConversationVersionConflictError';
  }
}

export type StartConversationInput = {
  orgId: string;
  processId?: string | null;
  parentThreadId?: string | null;
  ownerType: ConversationOwnerType;
  ownerId?: string | null;
  channel?: string | null;
  workflowVersionId?: string;
  workflowKey?: string;
  variables?: Record<string, unknown>;
  participants?: Array<{
    role: string;
    channel?: string | null;
    address?: string | null;
    displayName?: string | null;
    metadata?: Record<string, unknown>;
  }>;
  bindings?: Array<{
    channel: string;
    connectorId?: string | null;
    keyType: string;
    keyValue: string;
    priority?: number;
    expiresAt?: Date | null;
  }>;
};

function effectIdempotencyKey(threadId: string, effect: ConversationEffect): string {
  return `${threadId}:${effect.nodeId}:${effect.operationIndex}:${effect.type}`;
}

function eventTypeForSignal(signal: ConversationSignal): string {
  switch (signal.type) {
    case 'start': return 'thread_started';
    case 'inbound': return 'inbound_received';
    case 'action_result': return signal.ok ? 'action_completed' : 'action_failed';
    case 'timer_fired': return 'timer_fired';
    case 'approval_result': return 'approval_resolved';
    case 'subflow_result': return signal.ok ? 'action_completed' : 'action_failed';
    case 'cancel': return 'thread_canceled';
  }
}

function eventPayload(signal: ConversationSignal, envelope: ReturnType<typeof createTraceEnvelope>): Prisma.InputJsonValue {
  return attachTrace(signal, envelope) as Prisma.InputJsonValue;
}

async function enqueueEffects(
  tx: Prisma.TransactionClient,
  input: { orgId: string; threadId: string; threadChannel?: string | null; effects: ConversationEffect[]; now: Date },
): Promise<void> {
  for (const effect of input.effects) {
    const idempotencyKey = effectIdempotencyKey(input.threadId, effect);
    if (effect.type === 'timer') {
      await tx.conversationTimer.upsert({
        where: { idempotencyKey },
        create: {
          orgId: input.orgId,
          threadId: input.threadId,
          nodeId: effect.nodeId,
          idempotencyKey,
          purpose: effect.purpose,
          dueAt: new Date(input.now.getTime() + effect.delayMs),
        },
        update: {},
      });
      continue;
    }
    await tx.conversationOutbox.upsert({
      where: { idempotencyKey },
      create: {
        orgId: input.orgId,
        threadId: input.threadId,
        kind: effect.type,
        idempotencyKey,
        payload: (
          effect.type === 'send' && !effect.channel
            ? { ...effect, channel: input.threadChannel ?? undefined }
            : effect
        ) as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });
  }
}

async function incrementProcessOnStart(tx: Prisma.TransactionClient, processId: string | null): Promise<void> {
  if (!processId) return;
  await tx.$executeRaw`
    UPDATE conversation_processes
    SET counters = jsonb_set(
      jsonb_set(counters, '{total}', to_jsonb(COALESCE((counters->>'total')::int, 0) + 1)),
      '{active}', to_jsonb(COALESCE((counters->>'active')::int, 0) + 1)
    ), updated_at = CURRENT_TIMESTAMP
    WHERE id = ${processId}
  `;
}

async function incrementProcessOnTerminal(
  tx: Prisma.TransactionClient,
  processId: string | null,
  terminalStatus: string,
): Promise<void> {
  if (!processId) return;
  const key = ['completed', 'failed', 'canceled', 'expired', 'handed_off'].includes(terminalStatus)
    ? terminalStatus
    : 'completed';
  await tx.$executeRawUnsafe(
    `UPDATE conversation_processes
     SET counters = jsonb_set(
       jsonb_set(counters, '{active}', to_jsonb(GREATEST(COALESCE((counters->>'active')::int, 0) - 1, 0))),
       ARRAY[$1]::text[], to_jsonb(COALESCE((counters->>$1)::int, 0) + 1)
     ),
     status = CASE
       WHEN completion_mode IN ('all_terminal', 'all_terminal_or_timeout')
            AND COALESCE((counters->>'active')::int, 0) <= 1 THEN 'completed'
       WHEN completion_mode = 'first_success' AND $1 = 'completed' THEN 'completed'
       ELSE status
     END,
     completed_at = CASE
       WHEN (completion_mode IN ('all_terminal', 'all_terminal_or_timeout')
             AND COALESCE((counters->>'active')::int, 0) <= 1)
         OR (completion_mode = 'first_success' AND $1 = 'completed')
       THEN CURRENT_TIMESTAMP ELSE completed_at
     END,
     updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    key,
    processId,
  );
}

export async function startConversation(input: StartConversationInput): Promise<{ threadId: string }> {
  const published = await loadPublishedWorkflow({
    workflowVersionId: input.workflowVersionId,
    orgId: input.orgId,
    workflowKey: input.workflowKey,
  });
  const compiled = compileConversationWorkflow(published.workflow);
  const initial = createInitialConversationState(compiled, input.variables);
  const thread = await prisma.$transaction(async (tx) => {
    const created = await tx.conversationThread.create({
      data: {
        orgId: input.orgId,
        processId: input.processId ?? null,
        parentThreadId: input.parentThreadId ?? null,
        workflowVersionId: published.id,
        ownerType: input.ownerType,
        ownerId: input.ownerId ?? null,
        channel: input.channel ?? null,
        status: initial.status,
        currentNodeId: initial.currentNodeId,
        stateJson: initial as unknown as Prisma.InputJsonValue,
      },
    });
    if (input.participants?.length) {
      await tx.conversationParticipant.createMany({
        data: input.participants.map((participant) => ({
          threadId: created.id,
          role: participant.role,
          channel: participant.channel ?? null,
          address: participant.address ?? null,
          displayName: participant.displayName ?? null,
          metadata: (participant.metadata ?? {}) as Prisma.InputJsonValue,
        })),
      });
    }
    if (input.bindings?.length) {
      await tx.conversationBinding.createMany({
        data: input.bindings.map((binding) => ({
          orgId: input.orgId,
          threadId: created.id,
          channel: binding.channel,
          connectorId: binding.connectorId ?? null,
          keyType: binding.keyType,
          keyValue: binding.keyValue,
          priority: binding.priority ?? 0,
          expiresAt: binding.expiresAt ?? null,
        })),
      });
    }
    await incrementProcessOnStart(tx, input.processId ?? null);
    return created;
  });
  await signalConversation({ threadId: thread.id, signal: { type: 'start' }, idempotencyKey: 'thread:start' });
  return { threadId: thread.id };
}

export async function signalConversation(input: {
  threadId: string;
  signal: ConversationSignal;
  idempotencyKey: string;
  providerEventId?: string | null;
  occurredAt?: Date;
}): Promise<{ status: string; version: number; effects: ConversationEffect[]; result?: Record<string, unknown> }> {
  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.conversationEvent.findFirst({
      where: { threadId: input.threadId, idempotencyKey: input.idempotencyKey },
    });
    const thread = await tx.conversationThread.findUnique({ where: { id: input.threadId } });
    if (!thread) throw new Error(`Conversation thread ${input.threadId} was not found`);
    if (duplicate) {
      return { status: thread.status, version: thread.version, effects: [] };
    }
    if (!thread.workflowVersionId) throw new Error('Conversation thread has no workflow version');
    const version = await tx.conversationWorkflowVersion.findUnique({ where: { id: thread.workflowVersionId } });
    if (!version) throw new Error('Conversation workflow version was not found');
    const workflow = version.definition as unknown as ConversationWorkflow;
    const transition = transitionConversation(
      thread.stateJson as unknown as ConversationRuntimeState,
      compileConversationWorkflow(workflow),
      input.signal,
    );
    const nextVersion = thread.version + 1;
    const now = input.occurredAt ?? new Date();
    const event = await tx.conversationEvent.create({
      data: {
        orgId: thread.orgId,
        threadId: thread.id,
        seq: nextVersion,
        eventType: eventTypeForSignal(input.signal),
        direction: input.signal.type === 'inbound' ? 'inbound' : null,
        channel: thread.channel,
        idempotencyKey: input.idempotencyKey,
        providerEventId: input.providerEventId ?? null,
        payload: eventPayload(
          input.signal,
          createTraceEnvelope({
            traceId: thread.processId ?? thread.id,
            spanId: `conversation:${thread.id}:${nextVersion}`,
            parentSpanId: thread.processId ?? thread.id,
            executionId: thread.id,
            executionKind: 'conversation',
            orgId: thread.orgId,
          }),
        ),
        occurredAt: now,
      },
    });
    const terminal = ['completed', 'failed', 'canceled', 'expired', 'handed_off'].includes(transition.state.status);
    const updated = await tx.conversationThread.updateMany({
      where: { id: thread.id, version: thread.version },
      data: {
        version: nextVersion,
        status: transition.state.status,
        currentNodeId: transition.state.currentNodeId,
        stateJson: transition.state as unknown as Prisma.InputJsonValue,
        resultJson: transition.result as Prisma.InputJsonValue | undefined,
        errorMessage: transition.state.error,
        completedAt: terminal ? now : undefined,
      },
    });
    if (updated.count !== 1) throw new ConversationVersionConflictError();
    await enqueueEffects(tx, {
      orgId: thread.orgId,
      threadId: thread.id,
      threadChannel: thread.channel,
      effects: transition.effects,
      now,
    });
    if (terminal && !['completed', 'failed', 'canceled', 'expired', 'handed_off'].includes(thread.status)) {
      await incrementProcessOnTerminal(tx, thread.processId, transition.state.status);
      await tx.conversationBinding.updateMany({ where: { threadId: thread.id, active: true }, data: { active: false } });
      await tx.conversationTimer.updateMany({ where: { threadId: thread.id, status: 'scheduled' }, data: { status: 'canceled' } });
    }
    if (transition.effects.length) {
      await tx.conversationEvent.create({
        data: {
          orgId: thread.orgId,
          threadId: thread.id,
          seq: nextVersion + 1,
          eventType: 'outbound_requested',
          idempotencyKey: `${input.idempotencyKey}:effects`,
          payload: attachTrace(
            transition.effects,
            createTraceEnvelope({
              traceId: thread.processId ?? thread.id,
              spanId: `conversation:${thread.id}:${nextVersion + 1}`,
              parentSpanId: thread.processId ?? thread.id,
              executionId: thread.id,
              executionKind: 'conversation',
              orgId: thread.orgId,
            }),
          ) as Prisma.InputJsonValue,
          occurredAt: now,
        },
      });
      await tx.conversationThread.update({ where: { id: thread.id }, data: { version: nextVersion + 1 } });
      return { status: transition.state.status, version: nextVersion + 1, effects: transition.effects, result: transition.result };
    }
    void event;
    return { status: transition.state.status, version: nextVersion, effects: transition.effects, result: transition.result };
  });
}
