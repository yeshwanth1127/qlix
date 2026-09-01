import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { signalConversation } from './conversationEngine.service.js';

export type ConversationOutboxJob = {
  id: string;
  orgId: string;
  threadId: string;
  kind: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  attemptCount: number;
};

export type ConversationEffectHandler = (job: ConversationOutboxJob) => Promise<unknown>;

async function resumeAssessmentTeamRunIfReady(threadId: string, status: string): Promise<void> {
  if (status !== 'completed') return;
  const thread = await prisma.conversationThread.findUnique({ where: { id: threadId }, select: { processId: true } });
  if (!thread?.processId) return;
  const process = await prisma.conversationProcess.findUnique({ where: { id: thread.processId }, select: { externalRefType: true, externalRefId: true, metadata: true, counters: true } });
  const metadata = (process?.metadata ?? {}) as Record<string, unknown>;
  const counters = (process?.counters ?? {}) as Record<string, unknown>;
  if (process?.externalRefType !== 'team_run' || metadata.adapter !== 'assessment_review_v1' || Number(counters.active ?? 0) > 0 || !process.externalRefId) return;
  const run = await prisma.teamRun.findUnique({ where: { id: process.externalRefId }, select: { status: true } });
  if (run?.status !== 'paused') return;
  const { resumeTeamRun } = await import('../teams/teamsRunLauncher.js');
  await resumeTeamRun(process.externalRefId);
}

/** Claim with SKIP LOCKED so multiple workers can safely drain the same queue. */
export async function claimConversationOutbox(limit = 25): Promise<ConversationOutboxJob[]> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 100));
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    org_id: string;
    thread_id: string;
    kind: string;
    idempotency_key: string;
    payload: Record<string, unknown>;
    attempt_count: number;
  }>>`
    WITH picked AS (
      SELECT id
      FROM conversation_outbox
      WHERE status = 'pending' AND available_at <= CURRENT_TIMESTAMP
      ORDER BY available_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${safeLimit}
    )
    UPDATE conversation_outbox AS jobs
    SET status = 'processing', locked_at = CURRENT_TIMESTAMP,
        attempt_count = jobs.attempt_count + 1, updated_at = CURRENT_TIMESTAMP
    FROM picked
    WHERE jobs.id = picked.id
    RETURNING jobs.id, jobs.org_id, jobs.thread_id, jobs.kind,
              jobs.idempotency_key, jobs.payload, jobs.attempt_count
  `;
  return rows.map((row) => ({
    id: row.id,
    orgId: row.org_id,
    threadId: row.thread_id,
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    payload: row.payload,
    attemptCount: row.attempt_count,
  }));
}

export async function dispatchConversationOutboxOnce(
  handlers: Partial<Record<string, ConversationEffectHandler>>,
  limit = 25,
): Promise<{ completed: number; retried: number; dead: number }> {
  const jobs = await claimConversationOutbox(limit);
  let completed = 0;
  let retried = 0;
  let dead = 0;
  for (const job of jobs) {
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`No conversation effect handler registered for ${job.kind}`);
      const result = await handler(job);
      await prisma.conversationOutbox.update({
        where: { id: job.id },
        data: { status: 'completed', completedAt: new Date(), lockedAt: null, lastError: null },
      });
      if (job.kind === 'action' || job.kind === 'subflow') {
        const transitioned = await signalConversation({
          threadId: job.threadId,
          signal: job.kind === 'subflow'
            ? { type: 'subflow_result', ok: true, result }
            : { type: 'action_result', actionId: job.id, ok: true, result },
          idempotencyKey: `${job.idempotencyKey}:result`,
        });
        await resumeAssessmentTeamRunIfReady(job.threadId, transitioned.status);
      }
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const terminal = job.attemptCount >= 5 || !handler;
      const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attemptCount - 1));
      await prisma.conversationOutbox.update({
        where: { id: job.id },
        data: {
          status: terminal ? 'dead' : 'pending',
          lockedAt: null,
          lastError: message,
          availableAt: new Date(Date.now() + delayMs),
        },
      });
      if (terminal && (job.kind === 'action' || job.kind === 'subflow')) {
        await signalConversation({
          threadId: job.threadId,
          signal: job.kind === 'subflow'
            ? { type: 'subflow_result', ok: false, error: message }
            : { type: 'action_result', actionId: job.id, ok: false, error: message },
          idempotencyKey: `${job.idempotencyKey}:failed`,
        });
      }
      if (terminal) dead += 1;
      else retried += 1;
    }
  }
  return { completed, retried, dead };
}

export async function fireDueConversationTimers(limit = 100): Promise<number> {
  const due = await prisma.conversationTimer.findMany({
    where: { status: 'scheduled', dueAt: { lte: new Date() } },
    orderBy: { dueAt: 'asc' },
    take: Math.max(1, Math.min(Math.floor(limit), 500)),
  });
  let fired = 0;
  for (const timer of due) {
    const claimed = await prisma.conversationTimer.updateMany({
      where: { id: timer.id, status: 'scheduled' },
      data: { status: 'firing' },
    });
    if (claimed.count !== 1) continue;
    try {
      await signalConversation({
        threadId: timer.threadId,
        signal: { type: 'timer_fired', timerId: timer.id, payload: timer.payload as Record<string, unknown> },
        idempotencyKey: `${timer.idempotencyKey}:fired`,
        occurredAt: timer.dueAt,
      });
      await prisma.conversationTimer.update({
        where: { id: timer.id },
        data: { status: 'fired', firedAt: new Date() },
      });
      fired += 1;
    } catch (error) {
      await prisma.conversationTimer.update({
        where: { id: timer.id },
        data: {
          status: 'failed',
          payload: {
            ...(timer.payload as Record<string, unknown>),
            error: error instanceof Error ? error.message : String(error),
          } as Prisma.InputJsonValue,
        },
      });
    }
  }
  return fired;
}
