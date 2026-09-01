/**
 * Mid-run capability grants: when a user asks for something the agent cannot do,
 * the runner calls request_capability → this service creates a chat approval →
 * on yes we add the scopes (and team delegated scopes) so the run can continue.
 */
import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { AgentsService } from '../agents/agents.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { FORCE_JIT_SCOPES, SCOPE_CATALOG_BY_ID } from '../agents/scopeCatalog.js';
import { computeJitPollToken, publishJitRunActivity } from '../jit/jit.service.js';
import { prisma } from '../lib/prisma.js';
import { isMcpScope } from '../mcp/mcpScopeCatalog.js';
import { TeamsRepository } from '../teams/teams.repository.js';
import {
  labelsForCapabilityScopes,
  remapCapabilityScopesForRuntime,
} from './capabilityGrantLabels.js';

export const CAPABILITY_GRANT_ACTION = 'agent.capability_grant' as const;

export {
  labelsForCapabilityScopes,
  remapCapabilityScopesForRuntime,
} from './capabilityGrantLabels.js';

export class CapabilityGrantInvalidError extends Error {
  readonly code = 'invalid_capability_grant';
  constructor(message: string) {
    super(message);
  }
}

export class CapabilityGrantAgentNotFoundError extends Error {
  readonly code = 'agent_not_found';
  constructor(message = 'Agent not found') {
    super(message);
  }
}

function labelsForScopes(scopes: string[], reason?: string | null): string {
  return labelsForCapabilityScopes(scopes, reason);
}
async function computePrevHashForAgent(agentId: string): Promise<string> {
  const last = await prisma.actionLog.findFirst({
    where: { agentId },
    orderBy: { timestampMs: 'desc' },
    select: { prevHash: true, id: true, actionType: true, timestampMs: true },
  });
  if (!last) return '0'.repeat(64);
  const { createHash } = await import('node:crypto');
  return createHash('sha256')
    .update(`${last.id}|${last.actionType}|${last.timestampMs.toString()}|${last.prevHash}`)
    .digest('hex');
}

function normalizeRequestedScopes(raw: unknown): PermissionScope[] {
  if (!Array.isArray(raw)) return [];
  const out: PermissionScope[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const scope = item.trim();
    if (!scope || seen.has(scope)) continue;
    if (isMcpScope(scope)) {
      // MCP scopes are granted via bindings; mid-run catalog add is builtin-only for now.
      continue;
    }
    if (!SCOPE_CATALOG_BY_ID[scope as keyof typeof SCOPE_CATALOG_BY_ID]) continue;
    seen.add(scope);
    out.push(scope as PermissionScope);
  }
  return out;
}

export class CapabilityGrantService {
  constructor(
    private readonly agentsService: AgentsService = new AgentsService(),
    private readonly teamsRepo: TeamsRepository = new TeamsRepository(),
  ) {}

  /**
   * Runner entry: create a pending chat approval asking the user to add scopes.
   * Auto-approves when every requested scope is already granted.
   */
  async requestFromRunner(input: {
    agentId: string;
    scopes: string[];
    reason?: string;
    runId?: string | null;
    teamId?: string | null;
  }): Promise<{
    jitRequestId: string;
    expiresAtMs: number;
    pollToken: string;
    alreadyGranted: boolean;
    missingScopes: PermissionScope[];
  }> {
    const agent = await prisma.agent.findUnique({
      where: { id: input.agentId },
      select: {
        id: true,
        did: true,
        name: true,
        userId: true,
        orgId: true,
        permissionScopes: true,
        jitScopes: true,
        runtime: true,
      },
    });
    if (!agent) throw new CapabilityGrantAgentNotFoundError(`Unknown agent: ${input.agentId}`);

    const reason =
      typeof input.reason === 'string' && input.reason.trim()
        ? input.reason.trim().slice(0, 500)
        : 'Needed for the current user request';

    const requested = remapCapabilityScopesForRuntime({
      scopes: normalizeRequestedScopes(input.scopes),
      reason,
      runtime: agent.runtime,
    });
    if (requested.length === 0) {
      throw new CapabilityGrantInvalidError(
        'Provide at least one valid capability scope to request (e.g. email.send, web.research).',
      );
    }

    const held = new Set(agent.permissionScopes as string[]);
    let missing = requested.filter((s) => !held.has(s));

    // Team dispatches further restrict via delegatedScopes — treat undelegated as missing.
    let teamId = typeof input.teamId === 'string' ? input.teamId.trim() : '';
    if (!teamId && input.runId) {
      const run = await prisma.agentRun.findUnique({
        where: { id: input.runId },
        select: { teamId: true },
      });
      teamId = run?.teamId ?? '';
    }
    if (teamId) {
      const member = await prisma.teamMember.findUnique({
        where: { teamId_agentId: { teamId, agentId: agent.id } },
        select: { delegatedScopes: true },
      });
      if (member) {
        const delegated = new Set(member.delegatedScopes as string[]);
        missing = requested.filter((s) => !held.has(s) || !delegated.has(s));
      }
    }

    const runId = typeof input.runId === 'string' && input.runId.trim() ? input.runId.trim() : null;
    const requestedAtMs = Date.now();
    const ttlSeconds = 300;
    const expiresAtMs = requestedAtMs + ttlSeconds * 1000;
    const conversationId = runId
      ? (
          await prisma.agentRun.findUnique({
            where: { id: runId },
            select: { conversationId: true },
          })
        )?.conversationId ?? null
      : null;

    const toolPayload: Record<string, unknown> = {
      runId,
      scopes: requested,
      missingScopes: missing,
      reason,
      ...(teamId ? { teamId } : {}),
      kind: 'capability_grant',
      ...(agent.runtime ? { runtime: agent.runtime } : {}),
    };

    const prevHash = await computePrevHashForAgent(agent.id);
    const actionLog = await prisma.actionLog.create({
      data: {
        agentId: agent.id,
        userId: agent.userId,
        actionType: CAPABILITY_GRANT_ACTION,
        payload: {
          phase: 'capability_grant_request',
          did: agent.did,
          conversationId,
          toolPayload,
        } as Prisma.InputJsonValue,
        riskLevel: 'medium',
        status: 'pending',
        approvalStatus: 'pending',
        signature: '',
        prevHash,
        timestampMs: BigInt(requestedAtMs),
      },
    });

    await prisma.approval.create({
      data: {
        actionLogId: actionLog.id,
        userId: agent.userId,
        decision: 'pending',
        requestedAtMs: BigInt(requestedAtMs),
        ttlSeconds,
      },
    });

    if (missing.length === 0) {
      const token = crypto.randomUUID();
      await prisma.$transaction([
        prisma.approval.update({
          where: { actionLogId: actionLog.id },
          data: {
            decision: 'approved',
            decidedAtMs: BigInt(Date.now()),
            jitToken: token,
          },
        }),
        prisma.actionLog.update({
          where: { id: actionLog.id },
          data: { approvalStatus: 'approved', status: 'success' },
        }),
      ]);
      if (runId) {
        await publishJitRunActivity(runId, {
          message: 'capability_grant_granted',
          scope: CAPABILITY_GRANT_ACTION,
          scopes: requested,
          scopeLabel: labelsForScopes(requested, reason),
          auto: true,
          reason: 'already_granted',
          jitRequestId: actionLog.id,
          kind: 'capability_grant',
        });
      }
      return {
        jitRequestId: actionLog.id,
        expiresAtMs,
        pollToken: computeJitPollToken(actionLog.id),
        alreadyGranted: true,
        missingScopes: [],
      };
    }

    const scopeLabelText = labelsForScopes(missing, reason);
    if (runId) {
      await publishJitRunActivity(runId, {
        message: 'capability_grant_pending',
        scope: CAPABILITY_GRANT_ACTION,
        scopes: missing,
        scopeLabel: scopeLabelText,
        context: reason,
        jitRequestId: actionLog.id,
        channel: 'dashboard',
        kind: 'capability_grant',
      });
    }

    return {
      jitRequestId: actionLog.id,
      expiresAtMs,
      pollToken: computeJitPollToken(actionLog.id),
      alreadyGranted: false,
      missingScopes: missing,
    };
  }

  /**
   * Apply scopes after the user approves a capability_grant ActionLog.
   * Called from JitService.decide when actionType matches.
   */
  async applyApprovedGrant(actionLogId: string): Promise<{
    grantedScopes: PermissionScope[];
    permissionScopes: PermissionScope[];
    jitScopes: PermissionScope[];
    alwaysScopes: PermissionScope[];
  }> {
    const row = await prisma.actionLog.findUnique({
      where: { id: actionLogId },
      select: {
        id: true,
        agentId: true,
        userId: true,
        actionType: true,
        payload: true,
        agent: {
          select: {
            id: true,
            userId: true,
            orgId: true,
            permissionScopes: true,
            jitScopes: true,
            alwaysScopes: true,
            runtime: true,
          },
        },
      },
    });
    if (!row?.agent || row.actionType !== CAPABILITY_GRANT_ACTION) {
      throw new CapabilityGrantInvalidError('Not a capability grant request');
    }

    const payload = row.payload as Record<string, unknown> | null;
    const toolPayload =
      payload && typeof payload === 'object' && payload.toolPayload && typeof payload.toolPayload === 'object'
        ? (payload.toolPayload as Record<string, unknown>)
        : payload ?? {};
    const reason = typeof toolPayload.reason === 'string' ? toolPayload.reason : null;
    const requested = remapCapabilityScopesForRuntime({
      scopes: normalizeRequestedScopes(toolPayload.scopes ?? toolPayload.missingScopes),
      reason,
      runtime:
        typeof toolPayload.runtime === 'string'
          ? toolPayload.runtime
          : row.agent.runtime,
    });
    if (requested.length === 0) {
      throw new CapabilityGrantInvalidError('Capability grant has no scopes');
    }

    const agent = row.agent;
    const nextPermission = Array.from(
      new Set([...(agent.permissionScopes as PermissionScope[]), ...requested]),
    );
    const forceJit = new Set(FORCE_JIT_SCOPES as string[]);
    const nextJit = Array.from(
      new Set([
        ...(agent.jitScopes as PermissionScope[]),
        ...requested.filter((s) => forceJit.has(s)),
      ]),
    ).filter((s) => nextPermission.includes(s));

    const updated = await this.agentsService.updateAgentScopes(
      agent.userId,
      agent.orgId,
      agent.id,
      { permissionScopes: nextPermission, jitScopes: nextJit },
    );

    const teamId =
      typeof toolPayload.teamId === 'string' && toolPayload.teamId.trim()
        ? toolPayload.teamId.trim()
        : null;
    if (teamId && agent.orgId) {
      const member = await prisma.teamMember.findUnique({
        where: { teamId_agentId: { teamId, agentId: agent.id } },
        select: { delegatedScopes: true },
      });
      if (member) {
        const nextDelegated = Array.from(
          new Set([...(member.delegatedScopes as PermissionScope[]), ...requested]),
        ).filter((s) => updated.permissionScopes.includes(s));
        await this.teamsRepo.updateMemberScopes(teamId, agent.id, nextDelegated);
      }
    }

    // Persist expanded skills on the live agent run so hot-reload / resume sees them.
    const runId =
      typeof toolPayload.runId === 'string' && toolPayload.runId.trim()
        ? toolPayload.runId.trim()
        : null;
    if (runId) {
      const run = await prisma.agentRun.findUnique({
        where: { id: runId },
        select: { skills: true },
      });
      if (run) {
        const prev = Array.isArray(run.skills) ? (run.skills as string[]) : [];
        const nextSkills = Array.from(new Set([...prev, ...requested]));
        await prisma.agentRun.update({
          where: { id: runId },
          data: { skills: nextSkills },
        });
      }
      await publishJitRunActivity(runId, {
        message: 'capability_grant_granted',
        scope: CAPABILITY_GRANT_ACTION,
        scopes: requested,
        scopeLabel: labelsForScopes(requested, reason),
        jitRequestId: actionLogId,
        kind: 'capability_grant',
      });
    }

    return {
      grantedScopes: requested,
      permissionScopes: updated.permissionScopes,
      jitScopes: updated.jitScopes,
      alwaysScopes: updated.alwaysScopes,
    };
  }

  async emitDenied(actionLogId: string, decision: 'denied' | 'expired'): Promise<void> {
    const row = await prisma.actionLog.findUnique({
      where: { id: actionLogId },
      select: { actionType: true, payload: true },
    });
    if (!row || row.actionType !== CAPABILITY_GRANT_ACTION) return;
    const payload = row.payload as Record<string, unknown> | null;
    const toolPayload =
      payload && typeof payload === 'object' && payload.toolPayload && typeof payload.toolPayload === 'object'
        ? (payload.toolPayload as Record<string, unknown>)
        : payload ?? {};
    const reason = typeof toolPayload.reason === 'string' ? toolPayload.reason : null;
    const scopes = normalizeRequestedScopes(toolPayload.scopes ?? toolPayload.missingScopes);
    const runId =
      typeof toolPayload.runId === 'string' && toolPayload.runId.trim()
        ? toolPayload.runId.trim()
        : null;
    if (!runId) return;
    await publishJitRunActivity(runId, {
      message: decision === 'expired' ? 'capability_grant_expired' : 'capability_grant_denied',
      scope: CAPABILITY_GRANT_ACTION,
      scopes,
      scopeLabel: labelsForScopes(scopes, reason),
      jitRequestId: actionLogId,
      kind: 'capability_grant',
    });
  }
}

export function isCapabilityGrantAction(actionType: string): boolean {
  return actionType === CAPABILITY_GRANT_ACTION;
}

export function capabilityGrantScopeLabel(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'Add capability';
  const pl = payload as Record<string, unknown>;
  const tool =
    pl.toolPayload && typeof pl.toolPayload === 'object'
      ? (pl.toolPayload as Record<string, unknown>)
      : pl;
  const scopes = normalizeRequestedScopes(tool.scopes ?? tool.missingScopes);
  if (scopes.length === 0) return 'Add capability';
  const reason = typeof tool.reason === 'string' ? tool.reason : null;
  return labelsForCapabilityScopes(scopes, reason);
}
