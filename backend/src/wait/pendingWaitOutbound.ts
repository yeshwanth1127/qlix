import { randomUUID } from 'node:crypto';
import { TeamsRepository } from '../teams/teams.repository.js';
import type { PendingWaitOutbound, TeamRunCheckpoint } from '../teams/teams.types.js';
import { normalizeContactJid } from '../whatsapp/whatsappAutoReply.service.js';
import { upsertWaitContactInCheckpoint } from './waitContacts.js';

export function enqueuePendingWaitOutbound(
  checkpoint: TeamRunCheckpoint,
  outbound: Omit<PendingWaitOutbound, 'id' | 'queuedAt'> & { id?: string; queuedAt?: string },
): TeamRunCheckpoint {
  const entry: PendingWaitOutbound = {
    id: outbound.id ?? randomUUID(),
    agentId: outbound.agentId,
    connectorId: outbound.connectorId,
    recipient: outbound.recipient,
    message: outbound.message,
    replyInstructions: outbound.replyInstructions ?? null,
    jid: outbound.jid ?? null,
    phone: outbound.phone ?? null,
    name: outbound.name ?? null,
    queuedAt: outbound.queuedAt ?? new Date().toISOString(),
  };
  const existing = checkpoint.pendingWaitOutbounds ?? [];
  // Replace same recipient/jid if re-queued.
  const key = normalizeContactJid(entry.jid || entry.recipient);
  const filtered = existing.filter((row) => {
    const rowKey = normalizeContactJid(row.jid || row.recipient);
    return rowKey !== key;
  });
  return {
    ...checkpoint,
    pendingWaitOutbounds: [...filtered, entry],
  };
}

export async function persistPendingWaitOutbound(input: {
  teamRunId: string;
  outbound: Omit<PendingWaitOutbound, 'id' | 'queuedAt'> & { id?: string };
}): Promise<PendingWaitOutbound> {
  const repo = new TeamsRepository();
  const run = await repo.findRun(input.teamRunId);
  if (!run) throw new Error('Team run not found');
  const existing = (run.checkpointJson ?? null) as TeamRunCheckpoint | null;
  const base: TeamRunCheckpoint =
    existing ??
    ({
      plan: [],
      completedResults: [],
      nextStageIndex: 0,
      waitTriggerIds: [],
      waitReason: '',
    } satisfies TeamRunCheckpoint);

  let next = enqueuePendingWaitOutbound(base, input.outbound);
  if (input.outbound.jid) {
    next = upsertWaitContactInCheckpoint(next, {
      jid: input.outbound.jid,
      name: input.outbound.name,
      phone: input.outbound.phone,
      recipient: input.outbound.recipient,
    });
  }
  await repo.updateRunStatus(run.id, run.status, { checkpointJson: next });
  const queued = next.pendingWaitOutbounds?.[next.pendingWaitOutbounds.length - 1];
  if (!queued) throw new Error('Failed to queue WhatsApp outbound');
  return queued;
}

/**
 * After wait mode + TTL are set: deliver queued contact messages and arm WaitTriggers.
 */
export async function flushPendingWaitOutbounds(input: {
  teamRunId: string;
  orgId: string;
  userId: string;
  fulfillment: 'first_match' | 'collect_until_timeout';
  ttlHours: number;
}): Promise<{
  checkpoint: TeamRunCheckpoint;
  sent: Array<{ jid: string; recipient: string; ok: boolean; error?: string }>;
  triggerIds: string[];
}> {
  const repo = new TeamsRepository();
  const run = await repo.findRun(input.teamRunId);
  if (!run) throw new Error('Team run not found');
  let checkpoint = (run.checkpointJson ?? null) as TeamRunCheckpoint | null;
  if (!checkpoint) throw new Error('Team run has no checkpoint');

  const pending = [...(checkpoint.pendingWaitOutbounds ?? [])];
  if (pending.length === 0) {
    return { checkpoint, sent: [], triggerIds: checkpoint.waitTriggerIds ?? [] };
  }

  const { sendWhatsAppToRecipient } = await import('../connectors/whatsappServiceClient.js');
  const { WaitTriggerService, WAIT_TRIGGER_PROVISIONAL_TTL_HOURS } = await import(
    '../teams/waitTrigger.service.js'
  );
  const { normalizeReplyInstructions } = await import('../whatsapp/whatsappAutoReply.service.js');
  const waitTriggers = new WaitTriggerService();

  const sent: Array<{ jid: string; recipient: string; ok: boolean; error?: string }> = [];
  const triggerIds: string[] = [...(checkpoint.waitTriggerIds ?? [])];

  for (const item of pending) {
    const result = await sendWhatsAppToRecipient({
      connectorId: item.connectorId,
      recipient: item.jid || item.recipient,
      message: item.message,
    });
    if (!result.ok || !result.jid) {
      sent.push({
        jid: item.jid || item.recipient,
        recipient: item.recipient,
        ok: false,
        error: result.error ?? 'Send failed',
      });
      continue;
    }

    const armed = await waitTriggers.armTeamWhatsAppWait({
      teamRunId: input.teamRunId,
      orgId: input.orgId,
      userId: input.userId,
      agentId: item.agentId,
      connectorId: item.connectorId,
      contactJid: result.jid,
      replyInstructions: normalizeReplyInstructions(item.replyInstructions),
      fulfillment: input.fulfillment,
      ttlHours: input.ttlHours || WAIT_TRIGGER_PROVISIONAL_TTL_HOURS,
    });
    if (!triggerIds.includes(armed.id)) triggerIds.push(armed.id);

    checkpoint = upsertWaitContactInCheckpoint(checkpoint, {
      jid: result.jid,
      name: result.name ?? item.name,
      phone: result.phone ?? item.phone,
      recipient: item.recipient,
    });

    sent.push({ jid: result.jid, recipient: item.recipient, ok: true });
  }

  checkpoint = {
    ...checkpoint,
    pendingWaitOutbounds: [],
    waitTriggerIds: triggerIds,
  };

  return { checkpoint, sent, triggerIds };
}
