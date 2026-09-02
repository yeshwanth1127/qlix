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
import { loadPublishedWorkflow } from '../conversations/conversationWorkflow.service.js';
import {
  promptFromNode,
  type ConversationPrompt,
} from '../conversations/conversationPrompt.js';

export function applyConversationPromptToOutbound(
  outbound: Omit<PendingWaitOutbound, 'id' | 'queuedAt'> & { id?: string },
  prompt: ConversationPrompt,
): Omit<PendingWaitOutbound, 'id' | 'queuedAt'> & { id?: string } {
  if (prompt.kind === 'choice') {
    return {
      ...outbound,
      kind: 'poll',
      message: prompt.content,
      pollName: prompt.content,
      pollValues: prompt.options,
      pollSelectableCount: prompt.maxSelections ?? 1,
      replyInstructions: null,
    };
  }
  return {
    ...outbound,
    kind: 'text',
    message: prompt.content,
    replyInstructions: null,
  };
}

async function managedWorkflowEntryPrompt(
  repo: TeamsRepository,
  teamId: string,
): Promise<ConversationPrompt | null> {
  const team = await repo.findById(teamId);
  const config = team?.config as { conversationWorkflowVersionId?: string } | undefined;
  if (!team || !config?.conversationWorkflowVersionId) return null;
  try {
    const { workflow } = await loadPublishedWorkflow({
      workflowVersionId: config.conversationWorkflowVersionId,
      orgId: team.orgId,
    });
    const entry = workflow.nodes.find((node) => node.id === workflow.entryNodeId);
    if (!entry || (entry.type !== 'ask' && entry.type !== 'collect')) return null;
    return promptFromNode(entry);
  } catch (error) {
    console.warn(
      '[pending-wait] managed workflow entry unavailable:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

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

function pendingContactKey(row: {
  jid?: string | null;
  recipient: string;
}): string {
  return normalizeContactJid(row.jid || row.recipient) || row.recipient.trim();
}

/** Content fingerprint so identical retries do not stack; distinct goal steps stay distinct. */
export function pendingOutboundFingerprint(row: {
  jid?: string | null;
  recipient: string;
  kind?: PendingWaitOutbound['kind'];
  message?: string;
  pollName?: string | null;
  pollValues?: string[] | null;
  pollSelectableCount?: number | null;
  documentFileName?: string | null;
  documentStagedPath?: string | null;
}): string {
  const contact = pendingContactKey(row);
  const kind = row.kind ?? 'text';
  if (kind === 'poll') {
    return [
      contact,
      'poll',
      String(row.pollName ?? row.message ?? '')
        .trim()
        .toLowerCase(),
      JSON.stringify(row.pollValues ?? []),
      String(row.pollSelectableCount ?? 1),
    ].join('|');
  }
  if (kind === 'document') {
    return [
      contact,
      'document',
      String(row.documentStagedPath ?? '').trim(),
      String(row.documentFileName ?? row.message ?? '')
        .trim()
        .toLowerCase(),
    ].join('|');
  }
  return [contact, 'text', String(row.message ?? '').trim().toLowerCase()].join('|');
}

/**
 * Keep worker call order. Drop brochure-placeholder junk and exact duplicate
 * retries. Never invent greetings, documents, or polls — those come from the
 * user objective via the worker tools (or a managed conversation workflow).
 */
export function normalizePendingWaitOutbounds(
  pending: PendingWaitOutbound[],
): PendingWaitOutbound[] {
  const seen = new Set<string>();
  const out: PendingWaitOutbound[] = [];
  for (const row of pending) {
    if ((row.kind ?? 'text') === 'text' && isBrochurePlaceholderText(row.message)) {
      continue;
    }
    const fingerprint = pendingOutboundFingerprint(row);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push(row);
  }
  return out;
}

/** @deprecated Use normalizePendingWaitOutbounds — system no longer invents pack steps. */
export function completePendingOutreachPack(
  pending: PendingWaitOutbound[],
  _extras?: {
    brochureForContact?: (
      contactKey: string,
    ) => { fileName: string; mimetype: string; stagedPath: string } | null;
    poll?: { name: string; values: string[]; selectableCount?: number };
  },
): PendingWaitOutbound[] {
  return normalizePendingWaitOutbounds(pending);
}

/**
 * Sanitize queued outbounds before wait pause. Does not invent brochure/poll
 * content from the goal — only the worker (or managed workflow) may queue steps.
 */
export async function fillMissingOutreachPack(input: {
  teamRunId: string;
  orgId: string;
  goal: string;
  pending: PendingWaitOutbound[];
}): Promise<PendingWaitOutbound[]> {
  void input.teamRunId;
  void input.orgId;
  void input.goal;
  return normalizePendingWaitOutbounds(input.pending);
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
 * Identical content for the same contact is ignored (agent retries must not stack duplicates).
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
    brainDocumentId: outbound.brainDocumentId ?? null,
    replyInstructions: outbound.replyInstructions ?? null,
    jid: outbound.jid ?? null,
    phone: outbound.phone ?? null,
    name: outbound.name ?? null,
    queuedAt: outbound.queuedAt ?? new Date().toISOString(),
    lastError: outbound.lastError ?? null,
  };
  const existing = checkpoint.pendingWaitOutbounds ?? [];
  const fingerprint = pendingOutboundFingerprint(entry);
  if (existing.some((row) => pendingOutboundFingerprint(row) === fingerprint)) {
    return checkpoint;
  }
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
  const existing = (run.checkpointJson ?? null) as TeamRunCheckpoint | null;
  let authoritativeContact: { phone: string; name?: string };
  try {
    const mailbox = await repo.listMailboxResults(run.id);
    authoritativeContact = assertTeamOutboundAllowed(run, mailbox, {
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
  const managedEntryPrompt =
    (input.outbound.kind ?? 'text') === 'text' || (input.outbound.kind ?? 'text') === 'poll'
      ? await managedWorkflowEntryPrompt(repo, run.teamId)
      : null;
  if (managedEntryPrompt) {
    const recipientKey = normalizeContactJid(
      input.outbound.jid || input.outbound.recipient,
    );
    const alreadyQueued = existing?.pendingWaitOutbounds?.find(
      (row) => normalizeContactJid(row.jid || row.recipient) === recipientKey,
    );
    if (alreadyQueued) return alreadyQueued;
  }
  const rewritten = managedEntryPrompt
    ? applyConversationPromptToOutbound(input.outbound, managedEntryPrompt)
    : input.outbound;
  const authoritativeOutbound = {
    ...rewritten,
    // Preserve the source-of-truth name. WhatsApp may return a device-local
    // nickname for the same valid phone number.
    name: authoritativeContact.name ?? input.outbound.name,
  };
  const base: TeamRunCheckpoint =
    existing ??
    ({
      plan: [],
      completedResults: [],
      nextStageIndex: 0,
      waitTriggerIds: [],
      waitReason: '',
    } satisfies TeamRunCheckpoint);

  const fingerprint = pendingOutboundFingerprint(authoritativeOutbound);
  let next = enqueuePendingWaitOutbound(base, authoritativeOutbound);
  if (authoritativeOutbound.jid) {
    next = upsertWaitContactInCheckpoint(next, {
      jid: authoritativeOutbound.jid,
      name: authoritativeOutbound.name,
      phone: authoritativeOutbound.phone,
      recipient: authoritativeOutbound.recipient,
    });
  }
  await repo.updateRunStatus(run.id, run.status, { checkpointJson: next });
  const queued =
    next.pendingWaitOutbounds?.find((row) => pendingOutboundFingerprint(row) === fingerprint) ??
    next.pendingWaitOutbounds?.[next.pendingWaitOutbounds.length - 1];
  if (!queued) throw new Error('Failed to queue WhatsApp outbound');
  return queued;
}

/**
 * After wait mode + TTL are set: deliver queued contact messages in order and arm WaitTriggers.
 * Successfully sent items are removed progressively; failures stay queued with lastError.
 *
 * When the team has a managed conversation workflow, flush does not blast the agent queue.
 * It starts one workflow thread per contact (greeting → brochure → poll1, then wait).
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

  const team = await repo.findById(run.teamId);
  const managedWorkflowId = (team?.config as { conversationWorkflowVersionId?: string } | undefined)
    ?.conversationWorkflowVersionId;
  if (managedWorkflowId) {
    return flushManagedConversationOutbounds({
      ...input,
      run,
      checkpoint,
      allowed,
      repo,
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
        item.name ??
        result.name ??
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

async function flushManagedConversationOutbounds(input: {
  teamRunId: string;
  orgId: string;
  userId: string;
  fulfillment: 'first_match' | 'collect_until_timeout';
  ttlHours: number;
  run: { id: string; teamId: string; status: string };
  checkpoint: TeamRunCheckpoint;
  allowed: PendingWaitOutbound[];
  repo: TeamsRepository;
}): Promise<{
  checkpoint: TeamRunCheckpoint;
  sent: Array<{ jid: string; recipient: string; ok: boolean; error?: string; kind?: string }>;
  triggerIds: string[];
}> {
  const { WaitTriggerService, WAIT_TRIGGER_PROVISIONAL_TTL_HOURS } = await import(
    '../teams/waitTrigger.service.js'
  );
  const { normalizeContactJid } = await import('../whatsapp/whatsappAutoReply.service.js');
  const { findBrainBrochureDocument } = await import('../aiBrain/brainFileStorage.js');
  const waitTriggers = new WaitTriggerService();

  const groups = new Map<string, PendingWaitOutbound[]>();
  const order: string[] = [];
  for (const row of input.allowed) {
    const key = normalizeContactJid(row.jid || row.recipient) || row.recipient.trim();
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(row);
  }

  let brochureFallbackId: string | null | undefined;
  async function resolveBrochureId(rows: PendingWaitOutbound[]): Promise<string> {
    const fromQueue = rows.find((row) => row.brainDocumentId?.trim())?.brainDocumentId?.trim();
    if (fromQueue) return fromQueue;
    if (brochureFallbackId === undefined) {
      const match = await findBrainBrochureDocument(input.orgId);
      brochureFallbackId = match?.documentId ?? null;
    }
    return brochureFallbackId ?? '';
  }

  const sent: Array<{ jid: string; recipient: string; ok: boolean; error?: string; kind?: string }> =
    [];
  const triggerIds: string[] = [...(input.checkpoint.waitTriggerIds ?? [])];
  let checkpoint = input.checkpoint;

  for (const key of order) {
    const rows = groups.get(key)!;
    const template = rows[0]!;
    const contactJid = normalizeContactJid(template.jid || template.recipient);
    if (!contactJid) {
      sent.push({
        jid: template.recipient,
        recipient: template.recipient,
        ok: false,
        error: 'Missing WhatsApp jid for managed conversation start',
        kind: 'managed_workflow',
      });
      continue;
    }
    const textRow = rows.find((row) => (row.kind ?? 'text') === 'text');
    const contactName =
      template.name?.trim() ||
      textRow?.name?.trim() ||
      (textRow ? inferNameFromOutreachMessage(textRow.message) : null) ||
      '';
    const greetingMessage =
      textRow?.message?.trim() ||
      (contactName
        ? `Hi ${contactName}, thanks for connecting — we have a few quick questions.`
        : 'Hi, thanks for connecting — we have a few quick questions.');
    const documentId = await resolveBrochureId(rows);

    try {
      const armed = await waitTriggers.armTeamWhatsAppWait({
        teamRunId: input.teamRunId,
        orgId: input.orgId,
        userId: input.userId,
        agentId: template.agentId,
        connectorId: template.connectorId,
        contactJid,
        fulfillment: input.fulfillment,
        ttlHours: input.ttlHours || WAIT_TRIGGER_PROVISIONAL_TTL_HOURS,
        managedStart: {
          greetingMessage,
          documentId,
          contactName,
        },
      });
      if (!triggerIds.includes(armed.id)) triggerIds.push(armed.id);
      checkpoint = upsertWaitContactInCheckpoint(checkpoint, {
        jid: contactJid,
        name: contactName || null,
        phone: template.phone,
        recipient: template.recipient,
      });
      for (const row of rows) {
        if (row.kind === 'document') await unlinkStagedDocument(row.documentStagedPath);
      }
      sent.push({
        jid: contactJid,
        recipient: template.recipient,
        ok: true,
        kind: 'managed_workflow',
      });
    } catch (error) {
      sent.push({
        jid: contactJid,
        recipient: template.recipient,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        kind: 'managed_workflow',
      });
    }
  }

  checkpoint = {
    ...checkpoint,
    pendingWaitOutbounds: [],
    waitTriggerIds: triggerIds,
  };
  await input.repo.updateRunStatus(input.run.id, input.run.status as 'paused' | 'running' | 'queued', {
    checkpointJson: checkpoint,
  });
  return { checkpoint, sent, triggerIds };
}
