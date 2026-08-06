import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';

export interface ComplianceExportPack {
  generatedAt: string;
  orgId: string;
  actionLogCount: number;
  csv: string;
  merkleRoot: string;
  jitSummary: {
    pending: number;
    approved: number;
    denied: number;
  };
  gatewayRoutes: number;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Build a compliance export: ActionLog CSV + Merkle root + JIT counts + gateway_route events.
 */
export async function buildComplianceExportPack(input: {
  orgId: string;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<ComplianceExportPack> {
  const limit = Math.min(input.limit ?? 5000, 20_000);
  const agents = await prisma.agent.findMany({
    where: { orgId: input.orgId },
    select: { id: true },
  });
  const agentIds = agents.map((a) => a.id);

  const logs = await prisma.actionLog.findMany({
    where: {
      OR: [{ agentId: { in: agentIds } }, { user: { orgId: input.orgId } }],
      ...(input.from || input.to
        ? {
            timestampMs: {
              ...(input.from ? { gte: BigInt(input.from.getTime()) } : {}),
              ...(input.to ? { lte: BigInt(input.to.getTime()) } : {}),
            },
          }
        : {}),
    },
    orderBy: { timestampMs: 'asc' },
    take: limit,
    select: {
      id: true,
      agentId: true,
      userId: true,
      actionType: true,
      riskLevel: true,
      status: true,
      approvalStatus: true,
      prevHash: true,
      signature: true,
      timestampMs: true,
      payload: true,
    },
  });

  const header = [
    'id',
    'timestamp_ms',
    'agent_id',
    'user_id',
    'action_type',
    'risk_level',
    'status',
    'approval_status',
    'prev_hash',
    'signature',
    'session_key',
  ];
  const rows = [header.join(',')];
  const leafHashes: string[] = [];

  for (const log of logs) {
    const payload = (log.payload ?? {}) as Record<string, unknown>;
    const sessionKey =
      typeof payload.sessionKey === 'string'
        ? payload.sessionKey
        : typeof payload.gatewaySessionKey === 'string'
          ? payload.gatewaySessionKey
          : '';
    rows.push(
      [
        log.id,
        String(log.timestampMs),
        log.agentId ?? '',
        log.userId,
        log.actionType,
        log.riskLevel,
        log.status,
        log.approvalStatus,
        log.prevHash,
        log.signature,
        sessionKey,
      ]
        .map((c) => csvEscape(String(c)))
        .join(','),
    );
    leafHashes.push(
      createHash('sha256')
        .update(`${log.id}|${log.prevHash}|${log.signature}|${log.timestampMs}`)
        .digest('hex'),
    );
  }

  let merkleRoot = '';
  if (leafHashes.length === 0) {
    merkleRoot = createHash('sha256').update('empty').digest('hex');
  } else {
    let layer = leafHashes;
    while (layer.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i]!;
        const right = layer[i + 1] ?? left;
        next.push(createHash('sha256').update(left + right).digest('hex'));
      }
      layer = next;
    }
    merkleRoot = layer[0]!;
  }

  const approvals = await prisma.approval.groupBy({
    by: ['decision'],
    where: { user: { orgId: input.orgId } },
    _count: true,
  });
  const jitSummary = { pending: 0, approved: 0, denied: 0 };
  for (const row of approvals) {
    const d = row.decision.toLowerCase();
    if (d === 'pending' || d === 'requested') jitSummary.pending += row._count;
    else if (d === 'approved' || d === 'allow' || d === 'yes') jitSummary.approved += row._count;
    else jitSummary.denied += row._count;
  }

  const gatewayRoutes = await prisma.agentRunEvent.count({
    where: {
      type: 'gateway_route',
      run: { orgId: input.orgId },
    },
  });

  return {
    generatedAt: new Date().toISOString(),
    orgId: input.orgId,
    actionLogCount: logs.length,
    csv: rows.join('\n'),
    merkleRoot,
    jitSummary,
    gatewayRoutes,
  };
}
