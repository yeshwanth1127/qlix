import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { loadJwtSecret } from '../middleware/authenticateUser.js';

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function serverSignature(secret: string, parts: Record<string, unknown>): string {
  return `qlix:hmac:${crypto.createHmac('sha256', secret).update(canonicalJson(parts)).digest('hex')}`;
}

async function computePrevHashForAgent(agentId: string): Promise<string> {
  const last = await prisma.actionLog.findFirst({
    where: { agentId },
    orderBy: { timestampMs: 'desc' },
    select: { signature: true },
  });
  return last ? sha256Hex(last.signature) : '';
}

export async function appendEmailActionLog(input: {
  agentId: string;
  userId: string;
  actionType: 'email.read' | 'email.send';
  payload: Record<string, unknown>;
  status: 'success' | 'blocked' | 'failed';
  riskLevel: 'low' | 'medium' | 'high';
  teamRunId?: string | null;
}): Promise<void> {
  const secret = loadJwtSecret();
  const timestampMs = BigInt(Date.now());
  const prevHash = await computePrevHashForAgent(input.agentId);
  const signaturePayload = {
    kind: 'email_tool_event' as const,
    agentId: input.agentId,
    userId: input.userId,
    actionType: input.actionType,
    timestampMs: timestampMs.toString(),
    prevHash,
    payloadSummary: input.payload,
    teamRunId: input.teamRunId ?? null,
  };
  const signature = serverSignature(secret, signaturePayload);

  await prisma.actionLog.create({
    data: {
      agentId: input.agentId,
      userId: input.userId,
      actionType: input.actionType,
      payload: {
        phase: 'email_tool',
        ...input.payload,
        teamRunId: input.teamRunId ?? null,
      } as Prisma.InputJsonValue,
      riskLevel: input.riskLevel,
      status: input.status,
      approvalStatus: input.actionType === 'email.send' ? 'not_required' : 'not_required',
      signature,
      prevHash,
      timestampMs,
    },
  });
}
