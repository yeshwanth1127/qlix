import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { WaitTriggerInbound } from '../teams/waitTrigger.service.js';
import type { ConversationEffect, ConversationRuntimeState } from './conversation.types.js';
import { signalConversation, startConversation } from './conversationEngine.service.js';
import { attachTrace, createTraceEnvelope } from '../contracts/traceEnvelope.js';
import { conversationPluginRegistry } from './registry.js';
import { fallbackPromptFromContent } from './conversationPrompt.js';

export type TeamConversationInboundResult = {
  managed: boolean;
  terminal: boolean;
  sentMessages: string[];
};

export type ManagedWaitStartVars = {
  greetingMessage?: string | null;
  documentId?: string | null;
  contactName?: string | null;
};

async function configuredWorkflow(teamRunId: string) {
  const run = await prisma.teamRun.findUnique({
    where: { id: teamRunId },
    select: { team: { select: { config: true } } },
  });
  const config = (run?.team.config ?? {}) as { conversationWorkflowVersionId?: string };
  if (!config.conversationWorkflowVersionId) return null;
  const version = await prisma.conversationWorkflowVersion.findUnique({
    where: { id: config.conversationWorkflowVersionId },
  });
  if (!version || version.status !== 'published') return null;
  return version;
}

async function upsertTeamRunProcess(input: {
  orgId: string;
  teamRunId: string;
}): Promise<string> {
  const process = await prisma.conversationProcess.upsert({
    where: {
      orgId_externalRefType_externalRefId: {
        orgId: input.orgId,
        externalRefType: 'team_run',
        externalRefId: input.teamRunId,
      },
    },
    update: {},
    create: {
      orgId: input.orgId,
      ownerType: 'team',
      ownerId: input.teamRunId,
      externalRefType: 'team_run',
      externalRefId: input.teamRunId,
      completionMode: 'all_terminal_or_timeout',
      counters: { total: 0, active: 0 },
      metadata: { adapter: 'team_wait_v1' },
    },
    select: { id: true },
  });
  return process.id;
}

/**
 * Start the team's managed workflow for a contact and deliver opening effects
 * (greeting / brochure / first poll) until the thread is waiting on input.
 */
async function startManagedTeamWaitThread(input: {
  waitTriggerId: string;
  orgId: string;
  teamRunId: string;
  connectorId: string;
  contactJid: string;
  agentId?: string | null;
  expiresAt: Date;
  workflowVersionId: string;
  managedStart?: ManagedWaitStartVars;
}): Promise<string> {
  const processId = await upsertTeamRunProcess({
    orgId: input.orgId,
    teamRunId: input.teamRunId,
  });
  const contactName = input.managedStart?.contactName?.trim() || '';
  const greetingMessage =
    input.managedStart?.greetingMessage?.trim() ||
    (contactName
      ? `Hi ${contactName}, thanks for connecting — we have a few quick questions.`
      : 'Hi, thanks for connecting — we have a few quick questions.');
  const documentId = input.managedStart?.documentId?.trim() || '';

  const started = await startConversation({
    orgId: input.orgId,
    processId,
    ownerType: 'team',
    ownerId: input.teamRunId,
    channel: 'whatsapp',
    workflowVersionId: input.workflowVersionId,
    variables: {
      orgId: input.orgId,
      connectorId: input.connectorId,
      contactJid: input.contactJid,
      teamRunId: input.teamRunId,
      waitTriggerId: input.waitTriggerId,
      contactName,
      greetingMessage,
      documentId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    },
    participants: [
      {
        role: 'contact',
        channel: 'whatsapp',
        address: input.contactJid,
        displayName: contactName || null,
      },
    ],
    bindings: [
      {
        channel: 'whatsapp',
        connectorId: input.connectorId,
        keyType: 'participant_address',
        keyValue: input.contactJid,
        priority: 10,
        expiresAt: input.expiresAt,
      },
    ],
  });

  await prisma.waitTrigger.update({
    where: { id: input.waitTriggerId },
    data: { conversationThreadId: started.threadId },
  });

  const thread = await prisma.conversationThread.findUnique({
    where: { id: started.threadId },
    select: { stateJson: true },
  });
  if (thread?.stateJson) {
    await driveManagedConversationEffects({
      conversationThreadId: started.threadId,
      state: thread.stateJson as unknown as ConversationRuntimeState,
      bootstrapFromOutbox: true,
    });
  }

  await prisma.conversationEvent
    .create({
      data: {
        orgId: input.orgId,
        threadId: started.threadId,
        seq: 0,
        eventType: 'legacy_wait_armed',
        idempotencyKey: `wait:${input.waitTriggerId}:armed`,
        payload: attachTrace(
          {
            waitTriggerId: input.waitTriggerId,
            workflowVersionId: input.workflowVersionId,
            teamRunId: input.teamRunId,
            agentId: input.agentId ?? null,
            contactJid: input.contactJid,
            managedStart: true,
          },
          createTraceEnvelope({
            traceId: input.teamRunId,
            spanId: `conversation:${started.threadId}:0`,
            parentSpanId: input.teamRunId,
            executionId: started.threadId,
            executionKind: 'conversation',
            orgId: input.orgId,
            ...(input.agentId ? { agentId: input.agentId } : {}),
          }),
        ) as object,
      },
    })
    .catch(() => {
      /* seq may collide if start already wrote events — non-fatal */
    });

  return started.threadId;
}

export async function ensureLegacyTeamWaitThread(input: {
  waitTriggerId: string;
  orgId: string;
  teamRunId: string;
  connectorId: string;
  contactJid: string;
  agentId?: string | null;
  expiresAt: Date;
  managedStart?: ManagedWaitStartVars;
}): Promise<string> {
  const existing = await prisma.waitTrigger.findUnique({
    where: { id: input.waitTriggerId },
    select: { conversationThreadId: true },
  });
  if (existing?.conversationThreadId) return existing.conversationThreadId;

  const workflowVersion = await configuredWorkflow(input.teamRunId);
  if (workflowVersion) {
    return startManagedTeamWaitThread({
      ...input,
      workflowVersionId: workflowVersion.id,
      managedStart: input.managedStart,
    });
  }

  try {
    const { startOutreachConversations } = await import('./conversationCapability.service.js');
    const started = await startOutreachConversations({
      orgId: input.orgId,
      ownerType: 'team',
      ownerId: input.teamRunId,
      teamRunId: input.teamRunId,
      agentId: input.agentId ?? null,
      channel: 'whatsapp',
      recipients: [{ address: input.contactJid, connectorId: input.connectorId }],
      openingMessage: '',
      expiresAt: input.expiresAt,
    });
    const threadId = started.threads[0]?.threadId;
    if (threadId) {
      await prisma.waitTrigger.update({
        where: { id: input.waitTriggerId },
        data: { conversationThreadId: threadId },
      });
      return threadId;
    }
  } catch (error) {
    console.warn(
      '[legacy-team-wait] outreach conversation start failed; using adapter thread',
      error instanceof Error ? error.message : error,
    );
  }

  return prisma.$transaction(async (tx) => {
    const trigger = await tx.waitTrigger.findUnique({
      where: { id: input.waitTriggerId },
      select: { conversationThreadId: true },
    });
    if (trigger?.conversationThreadId) return trigger.conversationThreadId;

    const process = await tx.conversationProcess.upsert({
      where: {
        orgId_externalRefType_externalRefId: {
          orgId: input.orgId,
          externalRefType: 'team_run',
          externalRefId: input.teamRunId,
        },
      },
      update: {},
      create: {
        orgId: input.orgId,
        ownerType: 'team',
        ownerId: input.teamRunId,
        externalRefType: 'team_run',
        externalRefId: input.teamRunId,
        completionMode: 'all_terminal_or_timeout',
        counters: { total: 0, active: 0 },
        metadata: { adapter: 'team_wait_v1' },
      },
    });
    const state: Record<string, unknown> = {
      adapter: 'team_wait_v1',
      status: 'waiting_input',
      contactJid: input.contactJid,
      waitTriggerId: input.waitTriggerId,
    };
    const thread = await tx.conversationThread.create({
      data: {
        orgId: input.orgId,
        processId: process.id,
        workflowVersionId: null,
        ownerType: 'team',
        ownerId: input.teamRunId,
        channel: 'whatsapp',
        status: 'waiting_input',
        stateJson: state as Prisma.InputJsonValue,
      },
    });
    await tx.conversationParticipant.create({
      data: {
        threadId: thread.id,
        role: 'contact',
        channel: 'whatsapp',
        address: input.contactJid,
      },
    });
    await tx.conversationBinding.create({
      data: {
        orgId: input.orgId,
        threadId: thread.id,
        channel: 'whatsapp',
        connectorId: input.connectorId,
        keyType: 'participant_address',
        keyValue: input.contactJid,
        priority: 10,
        expiresAt: input.expiresAt,
      },
    });
    await tx.conversationEvent.create({
      data: {
        orgId: input.orgId,
        threadId: thread.id,
        seq: 0,
        eventType: 'legacy_wait_armed',
        idempotencyKey: `wait:${input.waitTriggerId}:armed`,
        payload: attachTrace(
          {
            waitTriggerId: input.waitTriggerId,
            workflowVersionId: null,
            teamRunId: input.teamRunId,
            agentId: input.agentId ?? null,
            contactJid: input.contactJid,
          },
          createTraceEnvelope({
            traceId: input.teamRunId,
            spanId: `conversation:${thread.id}:0`,
            parentSpanId: input.teamRunId,
            executionId: thread.id,
            executionKind: 'conversation',
            orgId: input.orgId,
            ...(input.agentId ? { agentId: input.agentId } : {}),
          }),
        ) as object,
      },
    });
    const claimed = await tx.waitTrigger.updateMany({
      where: { id: input.waitTriggerId, conversationThreadId: null },
      data: { conversationThreadId: thread.id },
    });
    if (claimed.count !== 1) {
      await tx.conversationEvent.deleteMany({ where: { threadId: thread.id } });
      await tx.conversationBinding.deleteMany({ where: { threadId: thread.id } });
      await tx.conversationParticipant.deleteMany({ where: { threadId: thread.id } });
      await tx.conversationThread.delete({ where: { id: thread.id } });
      const winner = await tx.waitTrigger.findUnique({
        where: { id: input.waitTriggerId },
        select: { conversationThreadId: true },
      });
      if (!winner?.conversationThreadId) {
        throw new Error('Could not bind conversation thread to wait trigger');
      }
      return winner.conversationThreadId;
    }
    await tx.$executeRaw`
      UPDATE conversation_processes
      SET counters = jsonb_set(
        jsonb_set(counters, '{total}', to_jsonb(COALESCE((counters->>'total')::int, 0) + 1)),
        '{active}', to_jsonb(COALESCE((counters->>'active')::int, 0) + 1)
      ), updated_at = CURRENT_TIMESTAMP
      WHERE id = ${process.id}
    `;
    return thread.id;
  });
}

export async function recordLegacyTeamWaitInbound(input: {
  conversationThreadId: string;
  inbound: WaitTriggerInbound;
  idempotencyKey?: string;
  providerEventId?: string | null;
}): Promise<TeamConversationInboundResult> {
  const existing = await prisma.conversationThread.findUnique({
    where: { id: input.conversationThreadId },
    select: { workflowVersionId: true, stateJson: true },
  });
  if (existing?.workflowVersionId) {
    return runManagedTeamConversation({
      conversationThreadId: input.conversationThreadId,
      inbound: input.inbound,
      idempotencyKey: input.idempotencyKey,
      providerEventId: input.providerEventId,
      state: existing.stateJson as unknown as ConversationRuntimeState,
    });
  }
  await prisma.$transaction(async (tx) => {
    const thread = await tx.conversationThread.findUnique({ where: { id: input.conversationThreadId } });
    if (!thread) return;
    if (input.idempotencyKey) {
      const duplicate = await tx.conversationEvent.findFirst({
        where: { threadId: thread.id, idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (duplicate) return;
    }
    const nextVersion = thread.version + 1;
    const updated = await tx.conversationThread.updateMany({
      where: { id: thread.id, version: thread.version },
      data: {
        version: nextVersion,
        status: 'completed',
        completedAt: new Date(input.inbound.timestampMs),
        resultJson: { inbound: input.inbound } as unknown as Prisma.InputJsonValue,
        stateJson: {
          ...(thread.stateJson as Record<string, unknown>),
          status: 'completed',
          lastInbound: input.inbound,
        } as Prisma.InputJsonValue,
      },
    });
    if (updated.count !== 1) return;
    await tx.conversationEvent.create({
      data: {
        orgId: thread.orgId,
        threadId: thread.id,
        seq: nextVersion,
        eventType: 'inbound_received',
        direction: 'inbound',
        channel: 'whatsapp',
        idempotencyKey: input.idempotencyKey ?? null,
        providerEventId: input.providerEventId ?? null,
        payload: attachTrace(
          input.inbound,
          createTraceEnvelope({
            traceId: thread.processId ?? thread.id,
            spanId: `conversation:${thread.id}:${nextVersion}`,
            parentSpanId: thread.processId ?? thread.id,
            executionId: thread.id,
            executionKind: 'conversation',
            orgId: thread.orgId,
          }),
        ) as Prisma.InputJsonValue,
        occurredAt: new Date(input.inbound.timestampMs),
      },
    });
    await tx.conversationBinding.updateMany({ where: { threadId: thread.id }, data: { active: false } });
    if (thread.processId && thread.status !== 'completed') {
      await tx.$executeRaw`
        UPDATE conversation_processes
        SET counters = jsonb_set(
          jsonb_set(counters, '{active}', to_jsonb(GREATEST(COALESCE((counters->>'active')::int, 0) - 1, 0))),
          '{completed}', to_jsonb(COALESCE((counters->>'completed')::int, 0) + 1)
        ),
        status = CASE
          WHEN completion_mode IN ('all_terminal', 'all_terminal_or_timeout')
               AND COALESCE((counters->>'active')::int, 0) <= 1 THEN 'completed'
          WHEN completion_mode = 'first_success' THEN 'completed'
          ELSE status
        END,
        completed_at = CASE
          WHEN (completion_mode IN ('all_terminal', 'all_terminal_or_timeout')
                AND COALESCE((counters->>'active')::int, 0) <= 1)
            OR completion_mode = 'first_success'
          THEN CURRENT_TIMESTAMP ELSE completed_at
        END,
        updated_at = CURRENT_TIMESTAMP
        WHERE id = ${thread.processId}
      `;
    }
  });
  return { managed: false, terminal: true, sentMessages: [] };
}

function classifierResult(effect: Extract<ConversationEffect, { type: 'action' }>): {
  label: string;
  confidence: number;
} {
  const text = String(effect.input.text ?? '').trim().toLowerCase();
  const allowed = Array.isArray(effect.input.allowedIntents)
    ? effect.input.allowedIntents.filter((item): item is string => typeof item === 'string')
    : [];
  const aliases: Record<string, string[]> = {
    yes: ['yes', 'y', 'yeah', 'yep', 'sure', 'interested', 'tell me more', 'please'],
    no: ['no', 'n', 'nope', 'not interested', 'stop'],
    brochure: ['brochure', 'document', 'pdf', 'send brochure'],
    counselor: ['counselor', 'counsellor', 'advisor', 'call', 'speak'],
  };
  const match = allowed.find((label) =>
    (aliases[label.toLowerCase()] ?? [label.toLowerCase()]).some(
      (alias) => text === alias || text.includes(alias),
    ),
  );
  return match ? { label: match, confidence: 0.95 } : { label: 'unclear', confidence: 0 };
}

async function completeOutboxEffect(threadId: string, effect: ConversationEffect): Promise<void> {
  const key = `${threadId}:${effect.nodeId}:${effect.operationIndex}:${effect.type}`;
  await prisma.conversationOutbox.updateMany({
    where: { threadId, idempotencyKey: key },
    data: { status: 'completed', completedAt: new Date(), lockedAt: null, lastError: null },
  });
}

async function failOutboxEffect(
  threadId: string,
  effect: ConversationEffect,
  error: string,
): Promise<void> {
  const key = `${threadId}:${effect.nodeId}:${effect.operationIndex}:${effect.type}`;
  await prisma.conversationOutbox.updateMany({
    where: { threadId, idempotencyKey: key },
    data: { status: 'failed', completedAt: new Date(), lockedAt: null, lastError: error },
  });
}

async function executeManagedAction(
  effect: Extract<ConversationEffect, { type: 'action' }>,
  state: ConversationRuntimeState,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  if (effect.action !== 'communication.send_brain_document') {
    return { ok: false, error: `Unsupported managed conversation action: ${effect.action}` };
  }
  const documentId = String(effect.input.documentId ?? '').trim();
  const orgId = String(state.variables.orgId ?? '').trim();
  const teamRunId = String(state.variables.teamRunId ?? '').trim();
  const connectorId = String(state.variables.connectorId ?? '').trim();
  const contactJid = String(state.variables.contactJid ?? '').trim();
  if (!documentId || !orgId || !teamRunId || !connectorId || !contactJid) {
    return { ok: false, error: 'Managed document action is missing required context' };
  }
  let stagedPath: string | null = null;
  try {
    const { loadBrainDocumentFile } = await import('../aiBrain/brainFileStorage.js');
    const { stagePendingWaitDocument, unlinkStagedDocument } = await import(
      '../wait/pendingWaitOutbound.js'
    );
    const { sendWhatsAppDocumentToRecipient } = await import(
      '../connectors/whatsappServiceClient.js'
    );
    const file = await loadBrainDocumentFile({ orgId, documentId });
    if (file.source === 'generated_pdf') {
      return {
        ok: false,
        error: 'Brain document has no original file — refusing generated PDF stand-in',
      };
    }
    const staged = await stagePendingWaitDocument({
      teamRunId,
      fileName: file.fileName,
      bytes: file.bytes,
    });
    stagedPath = staged.stagedPath;
    const delivery = await sendWhatsAppDocumentToRecipient({
      connectorId,
      recipient: contactJid,
      filePath: staged.stagedPath,
      fileName: staged.fileName,
      mimetype: file.mimetype,
    });
    await unlinkStagedDocument(stagedPath);
    stagedPath = null;
    return delivery.ok
      ? { ok: true, result: { documentId, fileName: staged.fileName, delivered: true } }
      : { ok: false, error: delivery.error ?? 'Document delivery failed' };
  } catch (error) {
    if (stagedPath) {
      const { unlinkStagedDocument } = await import('../wait/pendingWaitOutbound.js');
      await unlinkStagedDocument(stagedPath);
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function deliverManagedSendEffects(
  conversationThreadId: string,
  state: ConversationRuntimeState,
  effects: ConversationEffect[],
): Promise<string[]> {
  const sentMessages: string[] = [];
  const sends = effects.filter(
    (effect): effect is Extract<ConversationEffect, { type: 'send' }> => effect.type === 'send',
  );
  for (const effect of sends) {
    const prompt = fallbackPromptFromContent(effect.content, effect.prompt);
    await conversationPluginRegistry.deliverSend(
      effect.channel || 'whatsapp',
      {
        orgId: String(state.variables.orgId ?? ''),
        threadId: conversationThreadId,
        idempotencyKey: `${conversationThreadId}:${effect.nodeId}:${effect.operationIndex}:send`,
      },
      {
        content: prompt.content,
        prompt,
        metadata: effect.metadata,
      },
    );
    sentMessages.push(effect.content);
    await completeOutboxEffect(conversationThreadId, effect);
  }
  return sentMessages;
}

/**
 * Deliver send/action effects for a managed team thread until it is waiting on
 * human input (or terminal). Used after start and after each inbound reply.
 */
async function driveManagedConversationEffects(input: {
  conversationThreadId: string;
  state: ConversationRuntimeState;
  effects?: ConversationEffect[];
  bootstrapFromOutbox?: boolean;
}): Promise<TeamConversationInboundResult> {
  let state = input.state;
  let effects = input.effects ?? [];
  const sentMessages: string[] = [];

  if (input.bootstrapFromOutbox && effects.length === 0) {
    const pending = await prisma.conversationOutbox.findMany({
      where: { threadId: input.conversationThreadId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
    effects = pending.map((row) => row.payload as unknown as ConversationEffect);
  }

  for (let pass = 0; pass < 8; pass++) {
    if (effects.length === 0 && state.status === 'waiting_input') break;
    if (['completed', 'failed', 'canceled', 'expired', 'handed_off'].includes(state.status)) break;

    sentMessages.push(
      ...(await deliverManagedSendEffects(input.conversationThreadId, state, effects)),
    );

    const actions = effects.filter(
      (effect): effect is Extract<ConversationEffect, { type: 'action' }> => effect.type === 'action',
    );
    const action = actions[0];
    if (!action) {
      const fresh = await prisma.conversationThread.findUnique({
        where: { id: input.conversationThreadId },
        select: { stateJson: true, status: true },
      });
      if (fresh?.stateJson) state = fresh.stateJson as unknown as ConversationRuntimeState;
      break;
    }

    const outcome =
      action.action === 'conversation.classify'
        ? { ok: true, result: classifierResult(action) }
        : await executeManagedAction(action, state);
    if (outcome.ok) await completeOutboxEffect(input.conversationThreadId, action);
    else await failOutboxEffect(input.conversationThreadId, action, outcome.error ?? 'Action failed');

    const transition = await signalConversation({
      threadId: input.conversationThreadId,
      signal: {
        type: 'action_result',
        actionId: `${action.nodeId}:${action.operationIndex}`,
        ok: outcome.ok,
        result: outcome.result,
        error: outcome.error,
      },
      idempotencyKey: `${input.conversationThreadId}:${action.nodeId}:${action.operationIndex}:result`,
    });
    effects = transition.effects;
    const fresh = await prisma.conversationThread.findUnique({
      where: { id: input.conversationThreadId },
      select: { stateJson: true },
    });
    if (fresh?.stateJson) state = fresh.stateJson as unknown as ConversationRuntimeState;
  }

  const terminal = ['completed', 'failed', 'canceled', 'expired', 'handed_off'].includes(state.status);
  return { managed: true, terminal, sentMessages };
}

async function runManagedTeamConversation(input: {
  conversationThreadId: string;
  inbound: WaitTriggerInbound;
  idempotencyKey?: string;
  providerEventId?: string | null;
  state: ConversationRuntimeState;
}): Promise<TeamConversationInboundResult> {
  const transition = await signalConversation({
    threadId: input.conversationThreadId,
    signal: {
      type: 'inbound',
      text: input.inbound.text,
      payload: { pushName: input.inbound.pushName ?? null },
    },
    idempotencyKey:
      input.idempotencyKey ?? `${input.conversationThreadId}:inbound:${input.inbound.timestampMs}`,
    providerEventId: input.providerEventId,
    occurredAt: new Date(input.inbound.timestampMs),
  });
  const fresh = await prisma.conversationThread.findUnique({
    where: { id: input.conversationThreadId },
    select: { stateJson: true },
  });
  return driveManagedConversationEffects({
    conversationThreadId: input.conversationThreadId,
    state: (fresh?.stateJson as unknown as ConversationRuntimeState) ?? input.state,
    effects: transition.effects,
  });
}

export async function closeLegacyTeamWaitThreads(
  waitTriggerIds: string[],
  status: 'expired' | 'canceled',
): Promise<void> {
  if (waitTriggerIds.length === 0) return;
  const triggers = await prisma.waitTrigger.findMany({
    where: { id: { in: waitTriggerIds }, conversationThreadId: { not: null } },
    select: { id: true, conversationThreadId: true },
  });
  for (const trigger of triggers) {
    if (!trigger.conversationThreadId) continue;
    await prisma.$transaction(async (tx) => {
      const thread = await tx.conversationThread.findUnique({
        where: { id: trigger.conversationThreadId! },
      });
      if (!thread || ['completed', 'failed', 'canceled', 'expired'].includes(thread.status)) return;
      const nextVersion = thread.version + 1;
      const updated = await tx.conversationThread.updateMany({
        where: { id: thread.id, version: thread.version },
        data: {
          status,
          version: nextVersion,
          completedAt: new Date(),
          stateJson: {
            ...(thread.stateJson as Record<string, unknown>),
            status,
          } as Prisma.InputJsonValue,
        },
      });
      if (updated.count !== 1) return;
      await tx.conversationEvent.create({
        data: {
          orgId: thread.orgId,
          threadId: thread.id,
          seq: nextVersion,
          eventType: status === 'expired' ? 'thread_expired' : 'thread_canceled',
          idempotencyKey: `wait:${trigger.id}:${status}`,
          payload: attachTrace(
            { waitTriggerId: trigger.id, status },
            createTraceEnvelope({
              traceId: thread.processId ?? thread.id,
              spanId: `conversation:${thread.id}:${nextVersion}`,
              parentSpanId: thread.processId ?? thread.id,
              executionId: thread.id,
              executionKind: 'conversation',
              orgId: thread.orgId,
            }),
          ) as object,
        },
      });
      await tx.conversationBinding.updateMany({
        where: { threadId: thread.id },
        data: { active: false },
      });
      if (thread.processId) {
        await tx.$executeRawUnsafe(
          `UPDATE conversation_processes
           SET counters = jsonb_set(
             jsonb_set(counters, '{active}', to_jsonb(GREATEST(COALESCE((counters->>'active')::int, 0) - 1, 0))),
             ARRAY[$1]::text[], to_jsonb(COALESCE((counters->>$1)::int, 0) + 1)
           ),
           status = CASE
             WHEN completion_mode IN ('all_terminal', 'all_terminal_or_timeout')
                  AND COALESCE((counters->>'active')::int, 0) <= 1 THEN 'completed'
             ELSE status
           END,
           completed_at = CASE
             WHEN completion_mode IN ('all_terminal', 'all_terminal_or_timeout')
                  AND COALESCE((counters->>'active')::int, 0) <= 1 THEN CURRENT_TIMESTAMP
             ELSE completed_at
           END,
           updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          status,
          thread.processId,
        );
      }
    });
  }
}
