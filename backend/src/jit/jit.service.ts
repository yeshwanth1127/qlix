import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { verifySignature } from '../agents/keypair.js';
import { canonicalize } from '../actions/canonical.js';
import { prisma } from '../lib/prisma.js';
import { getWhatsAppConnectorForAgent } from '../connectors/whatsappConnector.service.js';
import { isWhatsAppJitEnabled, sendApproval } from './whatsappNotifier.js';

/** ±5 minutes — same window as actions. */
const SIGNATURE_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

export class AgentNotFoundError extends Error {
  readonly code = 'agent_not_found';
}

export class InvalidSignatureError extends Error {
  readonly code = 'invalid_signature';
}

export class StaleTimestampError extends Error {
  readonly code = 'stale_timestamp';
}

export class NotJitScopeError extends Error {
  readonly code = 'not_jit_scope';
}

export class JitRequestNotFoundError extends Error {
  readonly code = 'jit_request_not_found';
}

/** Signed body for POST /api/v1/jit/request — keys must match SDK canonical JSON. */
export interface JitRequestSignedPayload {
  did: string;
  actionType: string;
  payload: Record<string, unknown>;
  timestampMs: number;
}

function assertFreshTimestamp(timestampMs: number): void {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    throw new StaleTimestampError('timestampMs missing or non-finite');
  }
  const drift = Math.abs(Date.now() - timestampMs);
  if (drift > SIGNATURE_FRESHNESS_WINDOW_MS) {
    throw new StaleTimestampError(`timestamp drift ${drift}ms exceeds window`);
  }
}

async function assertSignature(
  signedPayload: unknown,
  signatureHex: string,
  agentPublicKeyHex: string,
): Promise<void> {
  const message = canonicalize(signedPayload);
  const ok = await verifySignature(message, signatureHex, agentPublicKeyHex).catch(() => false);
  if (!ok) throw new InvalidSignatureError();
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

async function computePrevHashForAgent(agentId: string): Promise<string> {
  const last = await prisma.actionLog.findFirst({
    where: { agentId },
    orderBy: { timestampMs: 'desc' },
    select: { signature: true },
  });
  return last ? sha256Hex(last.signature) : '';
}

const RUN_SCOPED_JIT_MS = 20 * 60_000;

/** Scopes already covered by replying to the WhatsApp goal (read/open files on PC). */
const WHATSAPP_RUN_AUTO_SCOPES = new Set(['system.file_write', 'system.gui_control']);

/**
 * In-memory run-scoped approval grants: once the user approves a scope for a run,
 * every later request for the same run+scope auto-approves (no repeat prompts).
 * Keyed by `${runId}::${actionType}` -> grant expiry epoch ms.
 */
const runScopedGrants = new Map<string, number>();

function grantKey(runId: string, actionType: string): string {
  return `${runId}::${actionType}`;
}

function recordRunScopedGrant(runId: string | null, actionType: string): void {
  if (!runId) return;
  runScopedGrants.set(grantKey(runId, actionType), Date.now() + RUN_SCOPED_JIT_MS);
}

function hasRunScopedGrantInMemory(runId: string | null, actionType: string): boolean {
  if (!runId) return false;
  const key = grantKey(runId, actionType);
  const expiry = runScopedGrants.get(key);
  if (expiry == null) return false;
  if (Date.now() > expiry) {
    runScopedGrants.delete(key);
    return false;
  }
  return true;
}

function extractRunId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.runId === 'string' && p.runId.trim()) return p.runId.trim();
  const nested = p.toolPayload;
  if (nested && typeof nested === 'object') {
    const rid = (nested as Record<string, unknown>).runId;
    if (typeof rid === 'string' && rid.trim()) return rid.trim();
  }
  return null;
}

function formatJitApprovalContext(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return String(payload ?? '');
  const p = payload as Record<string, unknown>;
  const tool = typeof p.tool === 'string' ? p.tool : '';
  const path = typeof p.path === 'string' ? p.path : '';
  const command = typeof p.command === 'string' ? p.command : '';
  const parts = [tool, path, command].filter(Boolean);
  if (parts.length > 0) return parts.join(' — ').slice(0, 500);
  return JSON.stringify(p).slice(0, 500);
}

async function isActiveWhatsAppAgentRun(runId: string): Promise<boolean> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { teamRole: true, status: true },
  });
  return (
    run?.teamRole === 'whatsapp' &&
    (run.status === 'queued' || run.status === 'running')
  );
}

async function hasRunScopedJitGrant(
  agentId: string,
  actionType: string,
  runId: string,
): Promise<boolean> {
  const since = BigInt(Date.now() - RUN_SCOPED_JIT_MS);
  const rows = await prisma.actionLog.findMany({
    where: {
      agentId,
      actionType,
      approvalStatus: 'approved',
      timestampMs: { gte: since },
    },
    orderBy: { timestampMs: 'desc' },
    take: 30,
    select: { payload: true },
  });
  for (const row of rows) {
    const payload = row.payload;
    if (!payload || typeof payload !== 'object') continue;
    const p = payload as Record<string, unknown>;
    const rid = extractRunId(p.toolPayload ?? p);
    if (rid === runId) return true;
  }
  return false;
}

async function autoApproveJitRequest(actionLogId: string): Promise<void> {
  const token = crypto.randomUUID();
  const now = Date.now();
  await prisma.$transaction([
    prisma.approval.update({
      where: { actionLogId },
      data: {
        decision: 'approved',
        decidedAtMs: BigInt(now),
        jitToken: token,
      },
    }),
    prisma.actionLog.update({
      where: { id: actionLogId },
      data: { approvalStatus: 'approved', status: 'success' },
    }),
  ]);
}

export class JitService {
  /**
   * Creates a pending JIT approval row (append-only action log + approval).
   * Returns the action-log id as jitRequestId for polling.
   */
  async request(input: { signedPayload: JitRequestSignedPayload; signature: string }): Promise<{
    jitRequestId: string;
    expiresAtMs: number;
  }> {
    const { signedPayload, signature } = input;
    assertFreshTimestamp(signedPayload.timestampMs);

    const agent = await prisma.agent.findUnique({
      where: { did: signedPayload.did },
      select: { id: true, did: true, name: true, userId: true, orgId: true, publicKey: true, jitScopes: true },
    });
    if (!agent) throw new AgentNotFoundError(`Unknown DID: ${signedPayload.did}`);

    await assertSignature(signedPayload, signature, agent.publicKey);

    const scopes = agent.jitScopes as string[];
    if (!scopes.includes(signedPayload.actionType)) {
      throw new NotJitScopeError(`Action ${signedPayload.actionType} is not a JIT scope for this agent`);
    }

    const prevHash = await computePrevHashForAgent(agent.id);
    const ttlSeconds = isWhatsAppJitEnabled() ? 300 : 120;
    const expiresAtMs = signedPayload.timestampMs + ttlSeconds * 1000;

    const actionLog = await prisma.actionLog.create({
      data: {
        agentId: agent.id,
        userId: agent.userId,
        actionType: signedPayload.actionType,
        payload: {
          phase: 'jit_request',
          did: signedPayload.did,
          toolPayload: signedPayload.payload,
        } as Prisma.InputJsonValue,
        riskLevel: 'high',
        status: 'pending',
        approvalStatus: 'pending',
        signature,
        prevHash,
        timestampMs: BigInt(signedPayload.timestampMs),
      },
    });

    await prisma.approval.create({
      data: {
        actionLogId: actionLog.id,
        userId: agent.userId,
        decision: 'pending',
        requestedAtMs: BigInt(signedPayload.timestampMs),
        ttlSeconds,
      },
    });

    const runId = extractRunId(signedPayload.payload);
    const envAutoApprove =
      process.env.QLIX_JIT_AUTO_APPROVE === '1' || process.env.QLIX_JIT_AUTO_APPROVE === 'true';
    const whatsappRunAuto =
      runId != null &&
      WHATSAPP_RUN_AUTO_SCOPES.has(signedPayload.actionType) &&
      (await isActiveWhatsAppAgentRun(runId));
    const memoryGrant = hasRunScopedGrantInMemory(runId, signedPayload.actionType);
    const runScopedReuse =
      memoryGrant ||
      (runId != null && (await hasRunScopedJitGrant(agent.id, signedPayload.actionType, runId)));

    console.log(
      `[jit] request created: actionId=${actionLog.id} agent=${agent.name} actionType=${signedPayload.actionType} ttl=${ttlSeconds}s ` +
        `runId=${runId ?? 'NULL'} envAuto=${envAutoApprove} whatsappRunAuto=${whatsappRunAuto} memoryGrant=${memoryGrant} runScopedReuse=${runScopedReuse} ` +
        `auto=${envAutoApprove || whatsappRunAuto || runScopedReuse}`,
    );

    if (envAutoApprove || whatsappRunAuto || runScopedReuse) {
      await autoApproveJitRequest(actionLog.id);
      // Remember this run+scope so all later requests in the run auto-approve too.
      recordRunScopedGrant(runId, signedPayload.actionType);
      console.log(`[jit] auto-approved: actionId=${actionLog.id} reason=${envAutoApprove ? 'env' : whatsappRunAuto ? 'whatsapp-run' : memoryGrant ? 'memory-grant' : 'run-scoped-db'}`);
    } else if (isWhatsAppJitEnabled()) {
      const wa = await getWhatsAppConnectorForAgent(agent.id);
      if (wa) {
        console.log(
          `[jit] sending WhatsApp approval: actionId=${actionLog.id} connector=${wa.id} context=${formatJitApprovalContext(signedPayload.payload)}`,
        );
        void sendApproval({
          connector_id: wa.id,
          action_id: actionLog.id,
          agent_name: agent.name,
          scope: signedPayload.actionType,
          context: formatJitApprovalContext(signedPayload.payload),
        });
      } else {
        console.log(`[jit] no WhatsApp connector found for agent: agentId=${agent.id}`);
      }
    } else {
      console.log(`[jit] waiting for approval (WhatsApp not enabled): actionId=${actionLog.id}`);
    }

    return { jitRequestId: actionLog.id, expiresAtMs };
  }

  /**
   * Human or WhatsApp channel decision for a pending JIT request.
   */
  async decide(input: {
    jitRequestId: string;
    approved: boolean;
    reason?: string | null;
  }): Promise<{ ok: true; status: 'approved' | 'denied' | 'expired' }> {
    const row = await prisma.actionLog.findUnique({
      where: { id: input.jitRequestId },
      include: { approval: true },
    });
    if (!row?.approval) {
      console.log(`[jit] decide: JIT request not found: actionId=${input.jitRequestId}`);
      throw new JitRequestNotFoundError();
    }

    console.log(
      `[jit] decide received: actionId=${input.jitRequestId} approved=${input.approved} reason=${input.reason ?? 'none'} currentStatus=${row.approval.decision}`,
    );

    if (row.approval.decision !== 'pending') {
      console.log(
        `[jit] already decided: actionId=${input.jitRequestId} decision=${row.approval.decision} (ignoring new decision)`,
      );
      return {
        ok: true,
        status:
          row.approval.decision === 'approved'
            ? 'approved'
            : row.approval.decision === 'expired'
              ? 'expired'
              : 'denied',
      };
    }

    const now = Date.now();
    const isTimeout = !input.approved && input.reason === 'timeout';

    if (input.approved) {
      const token = crypto.randomUUID();
      await prisma.$transaction([
        prisma.approval.update({
          where: { id: row.approval.id },
          data: {
            decision: 'approved',
            decidedAtMs: BigInt(now),
            jitToken: token,
          },
        }),
        prisma.actionLog.update({
          where: { id: row.id },
          data: { approvalStatus: 'approved', status: 'success' },
        }),
      ]);
      // Record an in-memory run-scoped grant so later requests in the same run
      // auto-approve without prompting the user again.
      const payload = row.payload;
      if (payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>;
        const runId = extractRunId(p.toolPayload ?? p);
        if (runId) {
          recordRunScopedGrant(runId, row.actionType);
          console.log(
            `[jit] recorded run-scoped grant: runId=${runId} actionType=${row.actionType} (future ${row.actionType} requests in this run auto-approve)`,
          );
        }
      }
      return { ok: true, status: 'approved' };
    }

    const decision = isTimeout ? 'expired' : 'denied';
    await prisma.$transaction([
      prisma.approval.update({
        where: { id: row.approval.id },
        data: {
          decision,
          decidedAtMs: BigInt(now),
        },
      }),
      prisma.actionLog.update({
        where: { id: row.id },
        data: {
          approvalStatus: decision,
          status: 'failed',
          payload: {
            ...(typeof row.payload === 'object' && row.payload !== null ? row.payload : {}),
            jitDecisionReason: input.reason ?? decision,
          } as Prisma.InputJsonValue,
        },
      }),
    ]);

    return { ok: true, status: decision };
  }

  /** Poll JIT status; returns jitToken only when approved and token is still valid. */
  async poll(jitRequestId: string): Promise<{
    status: 'pending' | 'approved' | 'denied' | 'expired';
    jitToken?: string;
  }> {
    const row = await prisma.actionLog.findUnique({
      where: { id: jitRequestId },
      include: { approval: true },
    });
    if (!row?.approval) throw new JitRequestNotFoundError();

    const now = Date.now();
    const requested = Number(row.approval.requestedAtMs);
    const ttlMs = row.approval.ttlSeconds * 1000;
    if (row.approval.decision === 'pending' && now > requested + ttlMs) {
      await prisma.approval.update({
        where: { id: row.approval.id },
        data: { decision: 'expired', decidedAtMs: BigInt(now) },
      });
      return { status: 'expired' };
    }

    if (row.approval.decision === 'pending') {
      return { status: 'pending' };
    }
    if (row.approval.decision === 'denied' || row.approval.decision === 'expired') {
      return { status: row.approval.decision === 'expired' ? 'expired' : 'denied' };
    }
    if (row.approval.decision === 'approved') {
      const token = row.approval.jitToken ?? undefined;
      return { status: 'approved', ...(token ? { jitToken: token } : {}) };
    }

    return { status: 'pending' };
  }
}
