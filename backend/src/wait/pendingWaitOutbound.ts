import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamsRepository } from '../teams/teams.repository.js';
import type { PendingWaitOutbound, TeamRunCheckpoint } from '../teams/teams.types.js';
import { normalizeContactJid } from '../whatsapp/whatsappAutoReply.service.js';
import { inferNameFromOutreachMessage } from './liveSheetColumns.js';
import { upsertWaitContactInCheckpoint } from './waitContacts.js';
import {
  assertTeamOutboundAllowed,
  TeamOutboundProvenanceError,
} from '../teams/teamOutboundGuard.js';

/** Durable staging root for queued contact documents (must stay under WA allowlist / tmpdir). */
export function pendingWaitDocumentDir(teamRunId: string): string {
  return join(tmpdir(), 'qlix-wa-pending', teamRunId);
}

export async function stagePendingWaitDocument(input: {
  teamRunId: string;
  fileName: string;
  bytes: Buffer;
}): Promise<{ stagedPath: string; fileName: string }> {
  const safeName = input.fileName.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 180) || 'document.bin';
  const dir = pendingWaitDocumentDir(input.teamRunId);
  await mkdir(dir, { recursive: true });
  const stagedPath = join(dir, `${randomUUID()}-${safeName}`);
  await writeFile(stagedPath, input.bytes);
  return { stagedPath, fileName: safeName };
}

export async function unlinkStagedDocument(path: string | null | undefined): Promise<void> {
  if (!path) return;
  await unlink(path).catch(() => {
    /* best-effort */
  });
}

export function isBrochurePlaceholderText(message: string): boolean {
  return /^(?:\[)?\s*brochure(?:\s+link)?\s*(?:\])?(?:\s*\.pdf)?\s*$/i.test(message.trim());
}

function pendingContactKey(row: PendingWaitOutbound): string {
  return normalizeContactJid(row.jid || row.recipient) || row.recipient.trim();
}

/**
 * After the outreach worker queues text, fill missing brochure file + Yes/No poll
 * per contact so wait-mode flush still sends the pack the user asked for.
 */
export function completePendingOutreachPack(
  pending: PendingWaitOutbound[],
  extras: {
    brochureForContact?: (
      contactKey: string,
    ) => { fileName: string; mimetype: string; stagedPath: string } | null;
    poll?: { name: string; values: string[]; selectableCount?: number };
  },
): PendingWaitOutbound[] {
  const groups = new Map<string, PendingWaitOutbound[]>();
  const order: string[] = [];
  for (const row of pending) {
    if ((row.kind ?? 'text') === 'text' && extras.brochureForContact && isBrochurePlaceholderText(row.message)) {
      continue;
    }
    const key = pendingContactKey(row);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(row);
  }

  const out: PendingWaitOutbound[] = [];
  for (const key of order) {
    const rows = groups.get(key)!;
    const template = rows[0]!;
    const kinds = new Set(rows.map((row) => row.kind ?? 'text'));
    out.push(...rows);

    const brochure = extras.brochureForContact?.(key) ?? null;
    if (brochure && !kinds.has('document')) {
      out.push({
        id: randomUUID(),
        agentId: template.agentId,
        connectorId: template.connectorId,
        recipient: template.recipient,
        message: brochure.fileName,
        kind: 'document',
        documentFileName: brochure.fileName,
        documentMimetype: brochure.mimetype,
        documentStagedPath: brochure.stagedPath,
        replyInstructions: template.replyInstructions ?? null,
        jid: template.jid ?? null,
        phone: template.phone ?? null,
        name: template.name ?? null,
        queuedAt: new Date().toISOString(),
      });
    }

    if (extras.poll && !kinds.has('poll')) {
      out.push({
        id: randomUUID(),
        agentId: template.agentId,
        connectorId: template.connectorId,
        recipient: template.recipient,
        message: extras.poll.name,
        kind: 'poll',
        pollName: extras.poll.name,
        pollValues: extras.poll.values,
        pollSelectableCount: extras.poll.selectableCount ?? 1,
        replyInstructions: template.replyInstructions ?? null,
        jid: template.jid ?? null,
        phone: template.phone ?? null,
        name: template.name ?? null,
        queuedAt: new Date().toISOString(),
      });
    }
  }
  return out;
}

export async function fillMissingOutreachPack(input: {
  teamRunId: string;
  orgId: string;
  goal: string;
  pending: PendingWaitOutbound[];
}): Promise<PendingWaitOutbound[]> {
  const { goalRequestsBrochureFile, goalRequestsInterestPoll } = await import('./waitPolicy.js');
  const wantBrochure = goalRequestsBrochureFile(input.goal);
  const wantPoll = goalRequestsInterestPoll(input.goal);
  if (!wantBrochure && !wantPoll) return input.pending;
  if (input.pending.length === 0) return input.pending;

  let brochureBytes: { fileName: string; mimetype: string; bytes: Buffer } | null = null;
  if (wantBrochure) {
    const { findBrainBrochureDocument, loadBrainDocumentFile } = await import(
      '../aiBrain/brainFileStorage.js'
    );
    const match = await findBrainBrochureDocument(input.orgId);
    if (match) {
      const file = await loadBrainDocumentFile({ orgId: input.orgId, documentId: match.documentId });
      brochureBytes = { fileName: file.fileName, mimetype: file.mimetype, bytes: file.bytes };
    }
  }

  const stagedByContact = new Map<string, { fileName: string; mimetype: string; stagedPath: string }>();
  if (brochureBytes) {
    const keys = new Set(input.pending.map((row) => pendingContactKey(row)));
    for (const key of keys) {
      const already = input.pending.some(
        (row) => pendingContactKey(row) === key && (row.kind ?? 'text') === 'document',
      );
      if (already) continue;
      const staged = await stagePendingWaitDocument({
        teamRunId: input.teamRunId,
        fileName: brochureBytes.fileName,
        bytes: brochureBytes.bytes,
      });
      stagedByContact.set(key, {
        fileName: staged.fileName,
        mimetype: brochureBytes.mimetype,
        stagedPath: staged.stagedPath,
      });
    }
  }

  return completePendingOutreachPack(input.pending, {
    brochureForContact: stagedByContact.size
      ? (key) => stagedByContact.get(key) ?? null
      : undefined,
    poll: wantPoll
      ? {
          name: 'Are you interested?',
          values: ['Yes', 'No'],
          selectableCount: 1,
        }
      : undefined,
  });
}

export function distinctPendingContactCount(pending: PendingWaitOutbound[]): number {
  const keys = new Set<string>();
  for (const row of pending) {
    const key = normalizeContactJid(row.jid || row.recipient);
    if (key) keys.add(key);
  }
  return keys.size;
}

/**
 * Append-only: multiple text/document/poll outbounds for the same contact stay in call order.
 */
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
    kind: outbound.kind ?? 'text',
    pollName: outbound.pollName,
    pollValues: outbound.pollValues,
    pollSelectableCount: outbound.pollSelectableCount,
    documentFileName: outbound.documentFileName,
    documentMimetype: outbound.documentMimetype,
    documentStagedPath: outbound.documentStagedPath,
    replyInstructions: outbound.replyInstructions ?? null,
    jid: outbound.jid ?? null,
    phone: outbound.phone ?? null,
    name: outbound.name ?? null,
    queuedAt: outbound.queuedAt ?? new Date().toISOString(),
    lastError: outbound.lastError ?? null,
  };
  const existing = checkpoint.pendingWaitOutbounds ?? [];
  return {
    ...checkpoint,
    pendingWaitOutbounds: [...existing, entry],
  };
}

export async function persistPendingWaitOutbound(input: {
  teamRunId: string;
  outbound: Omit<PendingWaitOutbound, 'id' | 'queuedAt'> & { id?: string };
}): Promise<PendingWaitOutbound> {
  const repo = new TeamsRepository();
  const run = await repo.findRun(input.teamRunId);
  if (!run) throw new Error('Team run not found');
  try {
    const mailbox = await repo.listMailboxResults(run.id);
    assertTeamOutboundAllowed(run, mailbox, {
      recipient: input.outbound.recipient,
      jid: input.outbound.jid ?? null,
      phone: input.outbound.phone ?? null,
      name: input.outbound.name ?? null,
    });
  } catch (error) {
    if (error instanceof TeamOutboundProvenanceError) {
      await repo.appendEvent(run.id, run.teamId, input.outbound.agentId, 'outbound_blocked', {
        message: error.message,
        recipient: input.outbound.recipient,
      });
    }
    throw error;
  }
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
 * After wait mode + TTL are set: deliver queued contact messages in order and arm WaitTriggers.
 * Successfully sent items are removed progressively; failures stay queued with lastError.
 */
export async function flushPendingWaitOutbounds(input: {
  teamRunId: string;
  orgId: string;
  userId: string;
  fulfillment: 'first_match' | 'collect_until_timeout';
  ttlHours: number;
}): Promise<{
  checkpoint: TeamRunCheckpoint;
  sent: Array<{ jid: string; recipient: string; ok: boolean; error?: string; kind?: string }>;
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
  const mailbox = await repo.listMailboxResults(run.id);
  const blocked: PendingWaitOutbound[] = [];
  const allowed = pending.filter((item) => {
    try {
      assertTeamOutboundAllowed(run, mailbox, item);
      return true;
    } catch {
      blocked.push(item);
      return false;
    }
  });
  if (blocked.length > 0) {
    checkpoint = { ...checkpoint, pendingWaitOutbounds: allowed };
    await repo.updateRunStatus(run.id, run.status, { checkpointJson: checkpoint });
    await repo.appendEvent(run.id, run.teamId, null, 'outbound_blocked', {
      message: `Blocked ${new Set(blocked.map((item) => item.recipient)).size} recipients: not present in source data`,
      recipients: [...new Set(blocked.map((item) => item.recipient))],
    });
  }

  const {
    sendWhatsAppDocumentToRecipient,
    sendWhatsAppPoll,
    sendWhatsAppToRecipient,
  } = await import('../connectors/whatsappServiceClient.js');
  const { WaitTriggerService, WAIT_TRIGGER_PROVISIONAL_TTL_HOURS } = await import(
    '../teams/waitTrigger.service.js'
  );
  const { normalizeReplyInstructions } = await import('../whatsapp/whatsappAutoReply.service.js');
  const waitTriggers = new WaitTriggerService();

  const sent: Array<{ jid: string; recipient: string; ok: boolean; error?: string; kind?: string }> =
    [];
  const triggerIds: string[] = [...(checkpoint.waitTriggerIds ?? [])];
  const remaining: PendingWaitOutbound[] = [];

  for (const item of allowed) {
    const kind = item.kind ?? 'text';
    const recipientKey = item.jid || item.recipient;
    let result: {
      ok: boolean;
      error?: string;
      jid?: string;
      phone?: string | null;
      name?: string | null;
    };

    if (kind === 'poll') {
      result = await sendWhatsAppPoll({
        connectorId: item.connectorId,
        recipient: recipientKey,
        name: item.pollName || item.message,
        values: item.pollValues ?? [],
        selectableCount: item.pollSelectableCount,
      });
    } else if (kind === 'document') {
      if (!item.documentStagedPath) {
        result = { ok: false, error: 'Queued document is missing staged file path' };
      } else {
        result = await sendWhatsAppDocumentToRecipient({
          connectorId: item.connectorId,
          recipient: recipientKey,
          filePath: item.documentStagedPath,
          fileName: item.documentFileName || item.message,
          mimetype: item.documentMimetype,
        });
      }
    } else {
      result = await sendWhatsAppToRecipient({
        connectorId: item.connectorId,
        recipient: recipientKey,
        message: item.message,
      });
    }

    if (!result.ok || !result.jid) {
      const error = result.error ?? 'Send failed';
      remaining.push({ ...item, lastError: error });
      sent.push({
        jid: item.jid || item.recipient,
        recipient: item.recipient,
        ok: false,
        error,
        kind,
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
      name:
        result.name ??
        item.name ??
        (kind === 'document'
          ? item.documentFileName ?? item.message
          : inferNameFromOutreachMessage(item.message)),
      phone: result.phone ?? item.phone,
      recipient: item.recipient,
    });

    if (kind === 'document') {
      await unlinkStagedDocument(item.documentStagedPath);
    }

    sent.push({ jid: result.jid, recipient: item.recipient, ok: true, kind });
  }

  checkpoint = {
    ...checkpoint,
    pendingWaitOutbounds: remaining,
    waitTriggerIds: triggerIds,
  };

  // Persist remaining failures so a later retry does not re-send successes.
  await repo.updateRunStatus(run.id, run.status, { checkpointJson: checkpoint });

  return { checkpoint, sent, triggerIds };
}
