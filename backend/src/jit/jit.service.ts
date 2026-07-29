import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { verifySignature } from '../agents/keypair.js';
import { canonicalize } from '../actions/canonical.js';
import { scopeRequiresJit } from '../actions/jitScope.js';
import { appendAgentRunLogEvent } from '../agentChat/agentRunService.js';
import { prisma } from '../lib/prisma.js';
import {
  getWhatsAppConnectionForAgent,
  getWhatsAppConnectorForAgent,
} from '../connectors/whatsappConnector.service.js';
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

export class JitForbiddenError extends Error {
  readonly code = 'jit_forbidden';
}

export class JitPollUnauthorizedError extends Error {
  readonly code = 'jit_poll_unauthorized';
}

/**
 * Stateless capability token for polling a JIT request. It is HMAC(server key, requestId), so only
 * the caller who received it from POST /request (the agent that signed the request) can present it.
 * This stops anyone who merely learns the request UUID (logs, chat, referrer) from polling and
 * stealing the one-time jitToken. No storage needed — recomputed and compared on each poll.
 */
export function computeJitPollToken(jitRequestId: string): string {
  const key = process.env.AGENT_SECRETS_KEY?.trim();
  if (!key) throw new Error('AGENT_SECRETS_KEY is required for JIT poll authentication');
  return crypto.createHmac('sha256', key).update(`jit-poll:${jitRequestId}`).digest('hex');
}

function jitPollTokenMatches(jitRequestId: string, provided: string): boolean {
  const expected = computeJitPollToken(jitRequestId);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
  const subject = typeof p.subject === 'string' ? p.subject.trim() : '';
  const to = Array.isArray(p.to) ? p.to.filter((x) => typeof x === 'string').slice(0, 3) : [];
  if (subject || to.length > 0) {
    const parts = [
      subject ? `Subject: ${subject}` : '',
      to.length > 0 ? `To: ${to.join(', ')}` : '',
    ].filter(Boolean);
    return parts.join(' · ').slice(0, 500);
  }
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

/** Scopes for which one human approval covers the whole conversation ("approve once per session"). */
const CONVERSATION_SCOPED_GRANT_SCOPES = new Set(['email.send']);

/** Safety expiry for a conversation-scoped grant; slid forward each time it auto-approves a request. */
const CONVERSATION_GRANT_TTL_MS = 24 * 60 * 60 * 1000;

async function resolveConversationId(runId: string | null): Promise<string | null> {
  if (!runId) return null;
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { conversationId: true },
  });
  return run?.conversationId ?? null;
}

/** True when an un-revoked, un-expired conversation grant exists for this scope. */
async function hasConversationScopedGrant(
  conversationId: string | null,
  scope: string,
): Promise<boolean> {
  if (!conversationId) return false;
  const grant = await prisma.jitScopeGrant.findUnique({
    where: { conversationId_scope: { conversationId, scope } },
    select: { revokedAt: true, expiresAt: true },
  });
  if (!grant || grant.revokedAt) return false;
  if (grant.expiresAt && grant.expiresAt.getTime() < Date.now()) return false;
  return true;
}

/** Create or re-arm a conversation-scoped grant after a human approves the scope. */
async function recordConversationScopedGrant(params: {
  conversationId: string;
  agentId: string;
  scope: string;
  userId: string;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + CONVERSATION_GRANT_TTL_MS);
  await prisma.jitScopeGrant.upsert({
    where: { conversationId_scope: { conversationId: params.conversationId, scope: params.scope } },
    create: {
      conversationId: params.conversationId,
      agentId: params.agentId,
      scope: params.scope,
      grantedByUserId: params.userId,
      expiresAt,
    },
    update: { expiresAt, revokedAt: null, grantedByUserId: params.userId },
  });
}

/** Slide the safety TTL forward whenever the grant auto-approves a request. */
async function touchConversationScopedGrant(conversationId: string, scope: string): Promise<void> {
  await prisma.jitScopeGrant.updateMany({
    where: { conversationId, scope, revokedAt: null },
    data: { expiresAt: new Date(Date.now() + CONVERSATION_GRANT_TTL_MS) },
  });
}

function formatScopeLabel(scope: string): string {
  const labels: Record<string, string> = {
    'system.file_write': 'Write files',
    'system.file_read': 'Read files',
    'system.gui_control': 'Control desktop',
    'email.send': 'Send email',
    'web.transaction': 'Web transactions',
  };
  return labels[scope] ?? scope;
}

async function emitJitRunLog(
  runId: string | null,
  data: Record<string, unknown>,
): Promise<void> {
  if (!runId) return;
  try {
    await appendAgentRunLogEvent(runId, data);
  } catch (err) {
    console.warn('[jit] failed to append run activity log:', err);
  }
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

export interface ConversationGrantDTO {
  id: string;
  conversationId: string;
  agentId: string;
  agentName: string | null;
  scope: string;
  createdAt: string;
  expiresAt: string | null;
}

export class JitService {
  /**
   * Creates a pending JIT approval row (append-only action log + approval).
   * Returns the action-log id as jitRequestId for polling.
   */
  async request(input: { signedPayload: JitRequestSignedPayload; signature: string }): Promise<{
    jitRequestId: string;
    expiresAtMs: number;
    pollToken: string;
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
    // Use the shared matcher so a whole-server `mcp.<slug>.*` jitScope covers a
    // per-tool `mcp.<slug>.<tool>` request — otherwise wildcard-bound (stdio) servers
    // can never have their tool calls approved, even though `/actions/start` allows them.
    if (!scopeRequiresJit(scopes, signedPayload.actionType)) {
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

    // Conversation-scoped grant: one earlier "yes" covers this scope for the whole
    // conversation (across tasks/runs), until revoked or the safety TTL lapses.
    const conversationId = CONVERSATION_SCOPED_GRANT_SCOPES.has(signedPayload.actionType)
      ? await resolveConversationId(runId)
      : null;
    const conversationGrant =
      conversationId != null &&
      (await hasConversationScopedGrant(conversationId, signedPayload.actionType));

    console.log(
      `[jit] request created: actionId=${actionLog.id} agent=${agent.name} actionType=${signedPayload.actionType} ttl=${ttlSeconds}s ` +
        `runId=${runId ?? 'NULL'} envAuto=${envAutoApprove} whatsappRunAuto=${whatsappRunAuto} memoryGrant=${memoryGrant} runScopedReuse=${runScopedReuse} conversationGrant=${conversationGrant} ` +
        `auto=${envAutoApprove || whatsappRunAuto || runScopedReuse || conversationGrant}`,
    );

    if (envAutoApprove || whatsappRunAuto || runScopedReuse || conversationGrant) {
      await autoApproveJitRequest(actionLog.id);
      // Remember this run+scope so all later requests in the run auto-approve too.
      recordRunScopedGrant(runId, signedPayload.actionType);
      // Slide the conversation grant's safety TTL forward on each use.
      if (conversationGrant && conversationId) {
        await touchConversationScopedGrant(conversationId, signedPayload.actionType);
      }
      const reason = envAutoApprove
        ? 'env'
        : whatsappRunAuto
          ? 'whatsapp-run'
          : conversationGrant
            ? 'conversation-grant'
            : memoryGrant
              ? 'memory-grant'
              : 'run-scoped-db';
      console.log(`[jit] auto-approved: actionId=${actionLog.id} reason=${reason}`);
      void emitJitRunLog(runId, {
        message: 'jit_approval_granted',
        scope: signedPayload.actionType,
        scopeLabel: formatScopeLabel(signedPayload.actionType),
        auto: true,
        reason: envAutoApprove ? 'env' : whatsappRunAuto ? 'whatsapp-run' : conversationGrant ? 'conversation' : 'run-scoped',
      });
    } else if (isWhatsAppJitEnabled()) {
      const wa = await getWhatsAppConnectorForAgent(agent.id);
      if (wa) {
        console.log(
          `[jit] sending WhatsApp approval: actionId=${actionLog.id} connector=${wa.id} context=${formatJitApprovalContext(signedPayload.payload)}`,
        );
        const sent = await sendApproval({
          connector_id: wa.id,
          action_id: actionLog.id,
          agent_name: agent.name,
          scope: signedPayload.actionType,
          context: formatJitApprovalContext(signedPayload.payload),
        });
        if (sent.ok) {
          void emitJitRunLog(runId, {
            message: 'jit_approval_pending',
            scope: signedPayload.actionType,
            scopeLabel: formatScopeLabel(signedPayload.actionType),
            channel: 'whatsapp',
            context: formatJitApprovalContext(signedPayload.payload),
            jitRequestId: actionLog.id,
          });
        } else {
          // WhatsApp delivery failed (e.g. session reconnecting) — never leave
          // the request silently stuck; surface it on the dashboard instead.
          console.warn(
            `[jit] WhatsApp approval delivery failed, falling back to dashboard: actionId=${actionLog.id} error=${sent.error}`,
          );
          void emitJitRunLog(runId, {
            message: 'jit_approval_pending',
            scope: signedPayload.actionType,
            scopeLabel: formatScopeLabel(signedPayload.actionType),
            channel: 'dashboard',
            context: formatJitApprovalContext(signedPayload.payload),
            jitRequestId: actionLog.id,
            whatsappError: sent.error ?? 'delivery failed',
            // Connector was linked but the message couldn't be delivered (session
            // reconnecting/down) — tell the user WhatsApp isn't reachable right now.
            whatsappExpected: true,
            whatsappStatus: 'disconnected',
          });
        }
      } else {
        const waConn = await getWhatsAppConnectionForAgent(agent.id);
        console.log(
          `[jit] WhatsApp not connected for agent: agentId=${agent.id} exists=${waConn.exists} connected=${waConn.connected}`,
        );
        void emitJitRunLog(runId, {
          message: 'jit_approval_pending',
          scope: signedPayload.actionType,
          scopeLabel: formatScopeLabel(signedPayload.actionType),
          channel: 'dashboard',
          context: formatJitApprovalContext(signedPayload.payload),
          jitRequestId: actionLog.id,
          // WhatsApp is the configured approval channel for this deployment but it
          // isn't connected — surface it so the user can reconnect (or approve here).
          whatsappExpected: true,
          whatsappStatus: waConn.exists ? 'disconnected' : 'not_linked',
        });
      }
    } else {
      console.log(`[jit] waiting for approval (WhatsApp not enabled): actionId=${actionLog.id}`);
      void emitJitRunLog(runId, {
        message: 'jit_approval_pending',
        scope: signedPayload.actionType,
        scopeLabel: formatScopeLabel(signedPayload.actionType),
        channel: 'dashboard',
        context: formatJitApprovalContext(signedPayload.payload),
        jitRequestId: actionLog.id,
      });
    }

    return { jitRequestId: actionLog.id, expiresAtMs, pollToken: computeJitPollToken(actionLog.id) };
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
    const payload = row.payload;
    const runId =
      payload && typeof payload === 'object'
        ? extractRunId((payload as Record<string, unknown>).toolPayload ?? payload)
        : null;

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
      if (payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>;
        const grantRunId = extractRunId(p.toolPayload ?? p);
        if (grantRunId) {
          recordRunScopedGrant(grantRunId, row.actionType);
          console.log(
            `[jit] recorded run-scoped grant: runId=${grantRunId} actionType=${row.actionType} (future ${row.actionType} requests in this run auto-approve)`,
          );
        }
      }
      // For session-scoped scopes (e.g. email.send), this one "yes" covers the whole
      // conversation: write a durable grant so every later run in the chat auto-approves.
      if (CONVERSATION_SCOPED_GRANT_SCOPES.has(row.actionType)) {
        const convoId = await resolveConversationId(runId);
        if (convoId) {
          await recordConversationScopedGrant({
            conversationId: convoId,
            agentId: row.agentId,
            scope: row.actionType,
            userId: row.userId,
          });
          console.log(
            `[jit] recorded conversation-scoped grant: conversationId=${convoId} scope=${row.actionType} (future ${row.actionType} requests in this conversation auto-approve)`,
          );
        }
      }
      void emitJitRunLog(runId, {
        message: 'jit_approval_granted',
        scope: row.actionType,
        scopeLabel: formatScopeLabel(row.actionType),
        channel: 'whatsapp',
      });
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

    void emitJitRunLog(runId, {
      message: decision === 'expired' ? 'jit_approval_expired' : 'jit_approval_denied',
      scope: row.actionType,
      scopeLabel: formatScopeLabel(row.actionType),
      channel: 'whatsapp',
      reason: input.reason ?? decision,
    });

    return { ok: true, status: decision };
  }

  /**
   * Authenticated dashboard decision: verifies the requesting user owns the agent
   * (personally or via its org) before resolving the pending request.
   */
  async decideAsUser(input: {
    jitRequestId: string;
    userId: string;
    orgId: string | null;
    approved: boolean;
  }): Promise<{ ok: true; status: 'approved' | 'denied' | 'expired' }> {
    const row = await prisma.actionLog.findUnique({
      where: { id: input.jitRequestId },
      select: { agent: { select: { userId: true, orgId: true } } },
    });
    if (!row?.agent) throw new JitRequestNotFoundError();
    const owns =
      row.agent.userId === input.userId ||
      (row.agent.orgId != null && row.agent.orgId === input.orgId);
    if (!owns) throw new JitForbiddenError();

    return this.decide({
      jitRequestId: input.jitRequestId,
      approved: input.approved,
      reason: input.approved ? 'dashboard' : 'denied_by_user',
    });
  }

  /** Poll JIT status; returns jitToken only when approved and token is still valid. */
  async poll(jitRequestId: string, pollToken: string): Promise<{
    status: 'pending' | 'approved' | 'denied' | 'expired';
    jitToken?: string;
  }> {
    // Backward compatibility: the poll token is a capability check layered on top of
    // the real gate — /api/v1/actions/start re-verifies the agent's Ed25519 signature
    // before a jitToken can be spent, so a leaked jitToken is useless without the
    // agent's private key. Runners provisioned before the poll-token change (or behind
    // a proxy that drops the header) send no token at all; hard-failing them silently
    // bricks every already-deployed runner — the JIT poll never returns, so the agent
    // never receives an approval it can see. So: reject a token that is PRESENT but
    // WRONG (tamper/probe), but allow a MISSING token as a legacy runner.
    if (pollToken) {
      if (!jitPollTokenMatches(jitRequestId, pollToken)) {
        throw new JitPollUnauthorizedError('Invalid JIT poll token');
      }
    } else {
      console.warn(
        `[jit] poll without token (legacy runner) actionId=${jitRequestId} — ` +
          'update the runner (re-download the starter pack / reinstall the qlix wheel) to restore poll-token auth',
      );
    }
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

  /** Active session grants (e.g. "email.send approved for this conversation") for a user's agents. */
  async listGrantsForUser(input: {
    userId: string;
    orgId: string | null;
  }): Promise<ConversationGrantDTO[]> {
    const agents = await prisma.agent.findMany({
      where: input.orgId ? { OR: [{ userId: input.userId }, { orgId: input.orgId }] } : { userId: input.userId },
      select: { id: true, name: true },
    });
    const agentName = new Map(agents.map((a) => [a.id, a.name]));
    if (agentName.size === 0) return [];

    const now = Date.now();
    const grants = await prisma.jitScopeGrant.findMany({
      where: { agentId: { in: [...agentName.keys()] }, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return grants
      .filter((g) => !g.expiresAt || g.expiresAt.getTime() > now)
      .map((g) => ({
        id: g.id,
        conversationId: g.conversationId,
        agentId: g.agentId,
        agentName: agentName.get(g.agentId) ?? null,
        scope: g.scope,
        createdAt: g.createdAt.toISOString(),
        expiresAt: g.expiresAt?.toISOString() ?? null,
      }));
  }

  /** Revoke a session grant; verifies the requesting user owns the grant's agent. */
  async revokeGrant(input: {
    grantId: string;
    userId: string;
    orgId: string | null;
  }): Promise<{ ok: true }> {
    const grant = await prisma.jitScopeGrant.findUnique({
      where: { id: input.grantId },
      select: { agentId: true, revokedAt: true },
    });
    if (!grant) throw new JitRequestNotFoundError();
    const agent = await prisma.agent.findUnique({
      where: { id: grant.agentId },
      select: { userId: true, orgId: true },
    });
    const owns =
      agent != null &&
      (agent.userId === input.userId || (agent.orgId != null && agent.orgId === input.orgId));
    if (!owns) throw new JitForbiddenError();

    if (!grant.revokedAt) {
      await prisma.jitScopeGrant.update({
        where: { id: input.grantId },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  }

  /** Whether this chat conversation already has an active grant for a JIT scope. */
  async hasActiveConversationGrantForRun(runId: string | null, scope: string): Promise<boolean> {
    const conversationId = await resolveConversationId(runId);
    if (!conversationId) return false;
    return hasConversationScopedGrant(conversationId, scope);
  }

  /** Slide conversation grant TTL on each auto-approved send. */
  async touchConversationGrantForRun(runId: string | null, scope: string): Promise<void> {
    const conversationId = await resolveConversationId(runId);
    if (conversationId) await touchConversationScopedGrant(conversationId, scope);
  }
}
