import { prisma } from '../lib/prisma.js';
import {
  jidLocalPart,
  normalizeContactJid,
} from '../whatsapp/whatsappAutoReply.service.js';
import {
  closeLegacyTeamWaitThreads,
  ensureLegacyTeamWaitThread,
  recordLegacyTeamWaitInbound,
} from '../conversations/legacyTeamWait.adapter.js';

/** Default chip / product wait after the user picks a duration. */
export const WAIT_TRIGGER_DEFAULT_TTL_HOURS = 24;
/** Provisional arm TTL until the user chooses a wait duration in chat. */
export const WAIT_TRIGGER_PROVISIONAL_TTL_HOURS = 168;
export const WAIT_TTL_PRESET_HOURS = [1, 6, 24, 48] as const;
export const WAIT_TTL_CUSTOM_MIN_HOURS = 0.25;
export const WAIT_TTL_CUSTOM_MAX_HOURS = 168;

/** @deprecated Prefer WAIT_TRIGGER_DEFAULT_TTL_HOURS — kept for older imports. */
export const WAIT_TRIGGER_TTL_HOURS = WAIT_TRIGGER_DEFAULT_TTL_HOURS;

export type WaitTriggerInbound = {
  jid: string;
  text: string;
  timestampMs: number;
  pushName?: string | null;
};

export interface ArmTeamWhatsAppWaitInput {
  teamRunId: string;
  orgId: string;
  userId: string;
  agentId: string;
  connectorId: string;
  contactJid: string;
  replyInstructions?: string | null;
  fulfillment?: 'first_match' | 'collect_until_timeout';
  /** When omitted, arms with the provisional 7-day safety cap until chat TTL is set. */
  ttlHours?: number;
}

export interface FulfilledTeamWait {
  triggerId: string;
  teamRunId: string;
  inbound: WaitTriggerInbound[];
}

export type TeamWaitProgress = {
  teamRunId: string;
  received: number;
  remaining: number;
  total: number;
};

export type TeamManagedConversationResult = {
  contactJid: string;
  threadId: string;
  status: string;
  variables: Record<string, unknown>;
  result: Record<string, unknown>;
  replies: WaitTriggerInbound[];
};

export type ConsumeWhatsAppInboundResult = {
  fulfilled: FulfilledTeamWait[];
  /** Team runs with zero open waits remaining after this inbound. */
  readyToResumeTeamRunIds: string[];
  /** Progress for every team run touched by this inbound. */
  progressByTeamRun: TeamWaitProgress[];
  /** A workflow thread consumed the reply and sent its own next-step message. */
  conversationHandled: boolean;
};

function expiresFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function inboundEvents(raw: unknown): WaitTriggerInbound[] {
  return Array.isArray(raw) ? (raw as WaitTriggerInbound[]) : [];
}

export function clampWaitTtlHours(hours: number): number {
  if (!Number.isFinite(hours)) {
    throw new Error('Wait duration must be a number of hours');
  }
  if (hours < WAIT_TTL_CUSTOM_MIN_HOURS || hours > WAIT_TTL_CUSTOM_MAX_HOURS) {
    throw new Error(
      `Wait duration must be between ${WAIT_TTL_CUSTOM_MIN_HOURS} and ${WAIT_TTL_CUSTOM_MAX_HOURS} hours`,
    );
  }
  return hours;
}

/** Resume only when every wait for the run is closed (fulfilled/expired). */
export function isTeamWaitReadyToResume(progress: {
  remaining: number;
  total: number;
}): boolean {
  return progress.remaining === 0 && progress.total > 0;
}

/**
 * Durable correlator for external events. V1 only arms WhatsApp inbound waits for
 * an already-running team stage; schema and lifecycle are intentionally generic.
 */
export class WaitTriggerService {
  async armTeamWhatsAppWait(input: ArmTeamWhatsAppWaitInput): Promise<{ id: string; expiresAt: Date }> {
    const contactJid = normalizeContactJid(input.contactJid);
    const existing = await prisma.waitTrigger.findFirst({
      where: {
        teamRunId: input.teamRunId,
        kind: 'whatsapp_inbound',
        status: 'open',
        connectorId: input.connectorId,
        contactJid,
      },
      select: { id: true, expiresAt: true, conversationThreadId: true },
    });
    if (existing) {
      // Later outbounds in an ordered multi-send (e.g. poll after greeting) may carry
      // the real reply instructions — update when provided.
      const instructions = input.replyInstructions?.trim() || null;
      if (instructions) {
        await prisma.waitTrigger.update({
          where: { id: existing.id },
          data: { replyInstructions: instructions },
        });
      }
      if (!existing.conversationThreadId) {
        await ensureLegacyTeamWaitThread({
          waitTriggerId: existing.id,
          orgId: input.orgId,
          teamRunId: input.teamRunId,
          connectorId: input.connectorId,
          contactJid,
          agentId: input.agentId,
          expiresAt: existing.expiresAt,
        });
      }
      return { id: existing.id, expiresAt: existing.expiresAt };
    }

    const ttlHours = input.ttlHours ?? WAIT_TRIGGER_PROVISIONAL_TTL_HOURS;
    const trigger = await prisma.waitTrigger.create({
      data: {
        orgId: input.orgId,
        userId: input.userId,
        kind: 'whatsapp_inbound',
        fulfillment: input.fulfillment ?? 'first_match',
        connectorId: input.connectorId,
        contactJid,
        agentId: input.agentId,
        continuationKind: 'resume_team_run',
        teamRunId: input.teamRunId,
        replyInstructions: input.replyInstructions?.trim() || null,
        expiresAt: expiresFromNow(ttlHours),
      },
      select: { id: true, expiresAt: true },
    });
    await ensureLegacyTeamWaitThread({
      waitTriggerId: trigger.id,
      orgId: input.orgId,
      teamRunId: input.teamRunId,
      connectorId: input.connectorId,
      contactJid,
      agentId: input.agentId,
      expiresAt: trigger.expiresAt,
    });
    return trigger;
  }

  async listOpenTeamWaits(teamRunId: string): Promise<Array<{
    id: string;
    contactJid: string | null;
    expiresAt: Date;
    fulfillment: string;
  }>> {
    return prisma.waitTrigger.findMany({
      where: { teamRunId, status: 'open', continuationKind: 'resume_team_run' },
      orderBy: { armedAt: 'asc' },
      select: { id: true, contactJid: true, expiresAt: true, fulfillment: true },
    });
  }

  async countOpenTeamWaits(teamRunId: string): Promise<number> {
    return prisma.waitTrigger.count({
      where: { teamRunId, status: 'open', continuationKind: 'resume_team_run' },
    });
  }

  async getTeamWaitProgress(teamRunId: string): Promise<TeamWaitProgress> {
    const rows = await prisma.waitTrigger.findMany({
      where: {
        teamRunId,
        continuationKind: 'resume_team_run',
        status: { in: ['open', 'fulfilled', 'expired'] },
      },
      select: { status: true, inboundJson: true, conversationThreadId: true },
    });
    const threadIds = rows
      .map((row) => row.conversationThreadId)
      .filter((id): id is string => Boolean(id));
    const threads = threadIds.length
      ? await prisma.conversationThread.findMany({
          where: { id: { in: threadIds } },
          select: { id: true, workflowVersionId: true, status: true },
        })
      : [];
    const threadById = new Map(threads.map((thread) => [thread.id, thread]));
    const total = rows.length;
    let received = 0;
    let remaining = 0;
    for (const row of rows) {
      const hasInbound = inboundEvents(row.inboundJson).length > 0;
      const conversation = row.conversationThreadId
        ? threadById.get(row.conversationThreadId)
        : null;
      const managedConversationOpen = Boolean(
        conversation?.workflowVersionId &&
        !['completed', 'failed', 'canceled', 'expired', 'handed_off'].includes(conversation.status),
      );
      if (row.status === 'fulfilled' || (hasInbound && !managedConversationOpen)) {
        received += 1;
      }
      // Still waiting only if open and no reply captured yet.
      if (row.status === 'open' && (!hasInbound || managedConversationOpen)) {
        remaining += 1;
      }
    }
    return { teamRunId, received, remaining, total };
  }

  /** Used by the WhatsApp sidecar gate: contact messages are only forwarded when armed. */
  async isContactWaitArmed(connectorId: string, remoteJid: string): Promise<boolean> {
    const matches = await this.findOpenTeamWaitsForContact(connectorId, remoteJid);
    return matches.length > 0;
  }

  private async findOpenTeamWaitsForContact(connectorId: string, remoteJid: string) {
    const contactJid = normalizeContactJid(remoteJid);
    const local = jidLocalPart(contactJid);
    const now = new Date();
    return prisma.waitTrigger.findMany({
      where: {
        kind: 'whatsapp_inbound',
        status: 'open',
        connectorId,
        expiresAt: { gt: now },
        continuationKind: 'resume_team_run',
        teamRunId: { not: null },
        teamRun: { is: { status: 'paused' } },
        OR: [
          { contactJid },
          ...(local.length >= 8
            ? [{ contactJid: { contains: local } }]
            : []),
        ],
      },
      select: {
        id: true,
        teamRunId: true,
        inboundJson: true,
        fulfillment: true,
        contactJid: true,
        conversationThreadId: true,
      },
      take: 10,
    });
  }

  async consumeWhatsAppInbound(input: {
    connectorId: string;
    contactJid: string;
    text: string;
    pushName?: string | null;
  }): Promise<ConsumeWhatsAppInboundResult> {
    const contactJid = normalizeContactJid(input.contactJid);
    const triggers = await this.findOpenTeamWaitsForContact(input.connectorId, contactJid);

    const event: WaitTriggerInbound = {
      jid: contactJid,
      text: input.text,
      timestampMs: Date.now(),
      pushName: input.pushName ?? null,
    };
    const fulfilled: FulfilledTeamWait[] = [];
    const touchedTeamRunIds = new Set<string>();
    let conversationHandled = false;

    for (const trigger of triggers) {
      if (trigger.teamRunId) touchedTeamRunIds.add(trigger.teamRunId);
      const inbound = [...inboundEvents(trigger.inboundJson), event];
      const conversation = trigger.conversationThreadId
        ? await recordLegacyTeamWaitInbound({
            conversationThreadId: trigger.conversationThreadId,
            inbound: event,
          })
        : null;
      if (conversation?.managed) {
        conversationHandled = true;
        const updated = await prisma.waitTrigger.updateMany({
          where: { id: trigger.id, status: 'open' },
          data: {
            inboundJson: inbound as object[],
            ...(conversation.terminal
              ? { status: 'fulfilled', fulfilledAt: new Date() }
              : {}),
          },
        });
        if (conversation.terminal && updated.count === 1 && trigger.teamRunId) {
          fulfilled.push({ triggerId: trigger.id, teamRunId: trigger.teamRunId, inbound });
        }
        continue;
      }
      if (trigger.fulfillment === 'collect_until_timeout') {
        await prisma.waitTrigger.update({
          where: { id: trigger.id },
          data: { inboundJson: inbound as object[] },
        });
        continue;
      }

      // A conditional write makes duplicate WA webhook deliveries one-shot.
      const updated = await prisma.waitTrigger.updateMany({
        where: { id: trigger.id, status: 'open' },
        data: {
          status: 'fulfilled',
          inboundJson: inbound as object[],
          fulfilledAt: new Date(),
        },
      });
      if (updated.count === 1 && trigger.teamRunId) {
        fulfilled.push({ triggerId: trigger.id, teamRunId: trigger.teamRunId, inbound });
      }
    }

    const readyToResumeTeamRunIds: string[] = [];
    const progressByTeamRun: TeamWaitProgress[] = [];
    for (const teamRunId of touchedTeamRunIds) {
      const progress = await this.getTeamWaitProgress(teamRunId);
      progressByTeamRun.push(progress);
      if (isTeamWaitReadyToResume(progress)) {
        readyToResumeTeamRunIds.push(teamRunId);
      }
    }

    return { fulfilled, readyToResumeTeamRunIds, progressByTeamRun, conversationHandled };
  }

  async loadFulfilledInbound(teamRunId: string, triggerIds: string[]): Promise<WaitTriggerInbound[]> {
    return this.loadCapturedInbound(teamRunId, triggerIds);
  }

  /** Full terminal workflow state, grouped by contact, for Team synthesis/artifacts. */
  async loadManagedConversationResults(
    teamRunId: string,
    triggerIds: string[],
  ): Promise<TeamManagedConversationResult[]> {
    if (triggerIds.length === 0) return [];
    const triggers = await prisma.waitTrigger.findMany({
      where: { teamRunId, id: { in: triggerIds }, conversationThreadId: { not: null } },
      select: { contactJid: true, conversationThreadId: true, inboundJson: true },
    });
    const threadIds = triggers
      .map((trigger) => trigger.conversationThreadId)
      .filter((id): id is string => Boolean(id));
    if (threadIds.length === 0) return [];
    const threads = await prisma.conversationThread.findMany({
      where: { id: { in: threadIds }, workflowVersionId: { not: null } },
      select: { id: true, status: true, stateJson: true, resultJson: true },
    });
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    return triggers.flatMap((trigger) => {
      const thread = trigger.conversationThreadId
        ? byId.get(trigger.conversationThreadId)
        : null;
      if (!thread) return [];
      const state = (thread.stateJson ?? {}) as Record<string, unknown>;
      const variables =
        state.variables && typeof state.variables === 'object' && !Array.isArray(state.variables)
          ? (state.variables as Record<string, unknown>)
          : {};
      const result =
        thread.resultJson && typeof thread.resultJson === 'object' && !Array.isArray(thread.resultJson)
          ? (thread.resultJson as Record<string, unknown>)
          : {};
      return [{
        contactJid: normalizeContactJid(trigger.contactJid ?? ''),
        threadId: thread.id,
        status: thread.status,
        variables,
        result,
        replies: inboundEvents(trigger.inboundJson),
      }];
    });
  }

  /**
   * All replies stored on wait triggers for this run — including ones that arrived
   * while the run was still running (before pause/TTL) or while the trigger stayed
   * `open` under collect_until_timeout.
   */
  async loadCapturedInbound(
    teamRunId: string,
    triggerIds?: string[],
  ): Promise<WaitTriggerInbound[]> {
    const triggers = await prisma.waitTrigger.findMany({
      where: {
        teamRunId,
        ...(triggerIds?.length ? { id: { in: triggerIds } } : {}),
        status: { in: ['open', 'fulfilled', 'expired'] },
      },
      select: { inboundJson: true, contactJid: true },
    });
    // Deduplicate by contact JID — keep the latest reply text per contact.
    const byJid = new Map<string, WaitTriggerInbound>();
    for (const trigger of triggers) {
      for (const event of inboundEvents(trigger.inboundJson)) {
        const key = normalizeContactJid(event.jid || trigger.contactJid || '');
        if (!key) continue;
        const prev = byJid.get(key);
        if (!prev || (event.timestampMs ?? 0) >= (prev.timestampMs ?? 0)) {
          byJid.set(key, { ...event, jid: key });
        }
      }
    }
    return [...byJid.values()];
  }

  /** Mark open waits that already have inbound as fulfilled (all-replied early resume). */
  async fulfillOpenWaitsWithInbound(teamRunId: string): Promise<number> {
    const open = await prisma.waitTrigger.findMany({
      where: { teamRunId, status: 'open', continuationKind: 'resume_team_run' },
      select: { id: true, inboundJson: true },
    });
    let count = 0;
    for (const trigger of open) {
      if (inboundEvents(trigger.inboundJson).length === 0) continue;
      const updated = await prisma.waitTrigger.updateMany({
        where: { id: trigger.id, status: 'open' },
        data: { status: 'fulfilled', fulfilledAt: new Date() },
      });
      count += updated.count;
    }
    return count;
  }

  async listCheckpointTriggerStatuses(
    teamRunId: string,
    triggerIds: string[],
  ): Promise<Array<{ id: string; status: string }>> {
    if (triggerIds.length === 0) return [];
    return prisma.waitTrigger.findMany({
      where: { teamRunId, id: { in: triggerIds } },
      select: { id: true, status: true },
    });
  }

  async areAllCheckpointTriggersTerminal(teamRunId: string, triggerIds: string[]): Promise<boolean> {
    if (triggerIds.length === 0) return false;
    const rows = await this.listCheckpointTriggerStatuses(teamRunId, triggerIds);
    if (rows.length !== triggerIds.length) return false;
    return rows.every((row) => row.status === 'fulfilled' || row.status === 'expired' || row.status === 'canceled');
  }

  async setExpiresAtForOpenTeamWaits(teamRunId: string, expiresAt: Date): Promise<number> {
    const open = await prisma.waitTrigger.findMany({
      where: { teamRunId, status: 'open', continuationKind: 'resume_team_run' },
      select: { conversationThreadId: true },
    });
    const result = await prisma.waitTrigger.updateMany({
      where: { teamRunId, status: 'open', continuationKind: 'resume_team_run' },
      data: { expiresAt },
    });
    const threadIds = open
      .map((trigger) => trigger.conversationThreadId)
      .filter((id): id is string => Boolean(id));
    if (threadIds.length) {
      await prisma.conversationBinding.updateMany({
        where: { threadId: { in: threadIds }, active: true },
        data: { expiresAt },
      });
    }
    return result.count;
  }

  async expireOpenWaitsForTeamRun(teamRunId: string): Promise<number> {
    const open = await prisma.waitTrigger.findMany({
      where: { teamRunId, status: 'open', continuationKind: 'resume_team_run' },
      select: { id: true },
    });
    const result = await prisma.waitTrigger.updateMany({
      where: { teamRunId, status: 'open', continuationKind: 'resume_team_run' },
      data: { status: 'expired' },
    });
    await closeLegacyTeamWaitThreads(open.map((trigger) => trigger.id), 'expired');
    return result.count;
  }

  async expireDue(): Promise<Array<{ id: string; teamRunId: string | null }>> {
    const due = await prisma.waitTrigger.findMany({
      where: { status: 'open', expiresAt: { lte: new Date() } },
      select: { id: true, teamRunId: true },
    });
    if (due.length === 0) return [];
    await prisma.waitTrigger.updateMany({
      where: { id: { in: due.map((trigger) => trigger.id) }, status: 'open' },
      data: { status: 'expired' },
    });
    await closeLegacyTeamWaitThreads(due.map((trigger) => trigger.id), 'expired');
    return due;
  }

  async cancelForTeamRun(teamRunId: string): Promise<void> {
    const open = await prisma.waitTrigger.findMany({
      where: { teamRunId, status: 'open' },
      select: { id: true },
    });
    await prisma.waitTrigger.updateMany({
      where: { teamRunId, status: 'open' },
      data: { status: 'canceled' },
    });
    await closeLegacyTeamWaitThreads(open.map((trigger) => trigger.id), 'canceled');
  }
}
