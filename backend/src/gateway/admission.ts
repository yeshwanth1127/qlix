import { prisma } from '../lib/prisma.js';
import { getActiveRun } from './sessionLane.js';
import type { AdmissionDecision, InboundMessage } from './types.js';

export type AdmissionPolicy = 'queue' | 'reject_parallel' | 'steer_if_running';

/**
 * Decide whether a new inbound turn may proceed for this session.
 * OpenClaw-inspired: interrupt / followup / steer / reject / proceed.
 */
export async function admitTurn(
  sessionKey: string,
  msg: InboundMessage,
  policy: AdmissionPolicy = 'queue',
): Promise<AdmissionDecision> {
  const memoryRunId = getActiveRun(sessionKey);
  const conversationId = msg.preResolved?.conversationId ?? msg.threadId ?? null;

  let dbActive: { id: string; status: string } | null = null;
  if (conversationId) {
    dbActive = await prisma.agentRun.findFirst({
      where: {
        conversationId,
        status: { in: ['queued', 'running'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
  }

  const activeRunId = memoryRunId ?? dbActive?.id;
  if (!activeRunId) {
    return { action: 'proceed' };
  }

  // Explicit steer markers (user mid-run guidance)
  const steerPrefix = msg.body.trim().toLowerCase();
  if (
    steerPrefix.startsWith('/steer') ||
    steerPrefix.startsWith('!steer') ||
    msg.metadata?.admission === 'steer'
  ) {
    return {
      action: 'steer',
      activeRunId,
      result: {
        status: 'steered',
        runId: activeRunId,
        sessionKey,
        ackReply: 'Steering active run…',
      },
    };
  }

  if (policy === 'reject_parallel') {
    return {
      action: 'reject',
      activeRunId,
      result: {
        status: 'rejected',
        reason: 'A run is already active for this conversation',
        sessionKey,
        ackReply: 'Busy — a run is already in progress. Wait or send /steer <note>.',
      },
    };
  }

  if (policy === 'steer_if_running' && dbActive?.status === 'running') {
    return {
      action: 'steer',
      activeRunId,
      result: {
        status: 'steered',
        runId: activeRunId,
        sessionKey,
        ackReply: 'Noted — steering the active run.',
      },
    };
  }

  // Default: serialize via session lane (caller still proceeds after prior turn).
  // Mark as followup so callers can attach metadata if needed.
  return { action: 'proceed', activeRunId };
}
