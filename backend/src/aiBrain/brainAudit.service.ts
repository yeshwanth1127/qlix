import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { loadJwtSecret } from '../middleware/authenticateUser.js';

export type BrainActionType =
  | 'brain.console_open'
  | 'brain.ensure_agent'
  | 'brain.collection_create'
  | 'brain.knowledge_ingest'
  | 'brain.knowledge_update'
  | 'brain.knowledge_delete'
  | 'brain.policy_check'
  | 'brain.query'
  | 'brain.model_update';

/** Where the operator action originated (for attribution). */
export type BrainAuditSurface = 'console' | 'agent_chat' | 'agent_tool';

async function computePrevHashForAgent(agentId: string): Promise<string> {
  const last = await prisma.actionLog.findFirst({
    where: { agentId },
    orderBy: { timestampMs: 'desc' },
    select: { signature: true },
  });
  return last ? sha256Hex(last.signature) : '';
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function brainServerSignature(secret: string, parts: Record<string, unknown>): string {
  const body = canonicalJson(parts);
  const h = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `qlix:hmac:${h}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const inner = entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',');
  return `{${inner}}`;
}

/** Human-operator brain events attributed to the org brain agent; signed with server HMAC (not agent Ed25519). */
export async function appendBrainActionLog(input: {
  brainAgentId: string;
  userId: string;
  actionType: BrainActionType;
  payload: Record<string, unknown>;
  status: 'success' | 'blocked' | 'flagged';
  riskLevel: 'low' | 'medium' | 'high';
  /** UI console vs agent chat vs runner/tool — defaults to console. */
  auditSurface?: BrainAuditSurface;
  /** Standard agent id that triggered a brain read (when surface is agent_*). */
  callingAgentId?: string;
}): Promise<void> {
  const secret = loadJwtSecret();
  const timestampMs = BigInt(Date.now());
  const prevHash = await computePrevHashForAgent(input.brainAgentId);
  const signaturePayload = {
    kind: 'brain_operator_event' as const,
    agentId: input.brainAgentId,
    userId: input.userId,
    actionType: input.actionType,
    timestampMs: timestampMs.toString(),
    prevHash,
    payloadSummary: input.payload,
  };
  const signature = brainServerSignature(secret, signaturePayload);

  const surface = input.auditSurface ?? 'console';
  await prisma.actionLog.create({
    data: {
      agentId: input.brainAgentId,
      userId: input.userId,
      actionType: input.actionType,
      payload: {
        ...input.payload,
        brainOperatorSource: 'brain_module',
        auditSurface: surface,
        operatorUserId: input.userId,
        ...(input.callingAgentId ? { callingAgentId: input.callingAgentId } : {}),
      } as Prisma.InputJsonValue,
      riskLevel: input.riskLevel,
      status: input.status,
      approvalStatus: 'not_required',
      signature,
      prevHash,
      timestampMs,
    },
  });
}
