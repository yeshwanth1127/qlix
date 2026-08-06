import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateUser } from '../middleware/authenticateUser.js';

const ONLINE_MS = 10 * 60 * 1000;
const IDLE_MS = 24 * 60 * 60 * 1000;

function formatRelativeLastActive(lastActive: Date | null): string {
  if (!lastActive) return 'Never';
  const diff = Date.now() - lastActive.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

function deriveAgentPresence(lastActive: Date | null): 'online' | 'idle' | 'offline' {
  if (!lastActive) return 'offline';
  const diff = Date.now() - lastActive.getTime();
  if (diff < ONLINE_MS) return 'online';
  if (diff < IDLE_MS) return 'idle';
  return 'offline';
}

function truncateDid(did: string): string {
  if (did.length <= 18) return did;
  return `${did.slice(0, 12)}...${did.slice(-6)}`;
}

function normalizeAuditAction(actionType: string): 'READ' | 'WRITE' | 'AUTH' {
  const u = actionType.toUpperCase();
  if (u.includes('AUTH')) return 'AUTH';
  if (u.includes('WRITE')) return 'WRITE';
  if (u.includes('READ')) return 'READ';
  return u.startsWith('W') ? 'WRITE' : u.startsWith('A') ? 'AUTH' : 'READ';
}

function normalizeAuditResult(status: string): 'Success' | 'Blocked' | 'Flagged' {
  const s = status.toLowerCase();
  if (s.includes('block')) return 'Blocked';
  if (s.includes('flag')) return 'Flagged';
  return 'Success';
}

function normalizeRiskLevel(risk: string): 'low' | 'medium' | 'high' {
  const r = risk.toLowerCase();
  if (r.includes('high')) return 'high';
  if (r.includes('med')) return 'medium';
  return 'low';
}

function readAuditSurface(payload: unknown): string | null {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const s = (payload as Record<string, unknown>).auditSurface;
    if (typeof s === 'string' && s.trim()) return s.trim();
  }
  return null;
}

function describeAuditPayload(payload: unknown, fallbackActionLabel: string): string {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    if (typeof o.description === 'string' && o.description.trim()) return o.description.trim();
    if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
    if (typeof o.summary === 'string' && o.summary.trim()) return o.summary.trim();
  }
  return fallbackActionLabel.replace(/_/g, ' ');
}

function dayBoundsUtc(now = new Date()): { start: bigint; next: bigint } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const next = new Date(start.getTime() + 86400_000);
  return { start: BigInt(start.getTime()), next: BigInt(next.getTime()) };
}

function weekBoundsUtc(now = new Date()): { start: bigint } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  const mondayOffset = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return { start: BigInt(d.getTime()) };
}

export function createDashboardRouter(): Router {
  const router = Router();

  router.get('/home', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      if (!org) {
        response.status(404).json({ error: { code: 'not_found', message: 'Organization not found' } });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: request.auth!.userId } });
      if (!user) {
        response.status(404).json({ error: { code: 'not_found', message: 'User not found' } });
        return;
      }

      const workspaceKind = org.workspaceKind === 'organization' ? 'organization' : 'individual';

      const agents = await prisma.agent.findMany({
        where: { orgId },
        orderBy: [{ lastActive: 'desc' }, { createdAt: 'desc' }],
        take: 12,
      });

      const agentCount = await prisma.agent.count({ where: { orgId } });

      const now = new Date();
      const { start: todayStart, next: tomorrowStart } = dayBoundsUtc(now);
      const yesterdayStart = BigInt(Number(todayStart) - 86400_000);
      const yesterdayEnd = todayStart;

      const actionsToday = await prisma.actionLog.count({
        where: {
          agent: { orgId },
          timestampMs: { gte: todayStart, lt: tomorrowStart },
        },
      });

      const actionsYesterday = await prisma.actionLog.count({
        where: {
          agent: { orgId },
          timestampMs: { gte: yesterdayStart, lt: yesterdayEnd },
        },
      });

      const onlineThreshold = new Date(Date.now() - ONLINE_MS);
      const agentsOnline = await prisma.agent.count({
        where: {
          orgId,
          lastActive: { gte: onlineThreshold },
        },
      });

      const { start: weekStart } = weekBoundsUtc(now);
      const actionsThisWeek = await prisma.actionLog.count({
        where: {
          agent: { orgId },
          timestampMs: { gte: weekStart },
        },
      });

      const prevWeekStart = BigInt(Number(weekStart) - 7 * 86400_000);
      const actionsPrevWeek = await prisma.actionLog.count({
        where: {
          agent: { orgId },
          timestampMs: { gte: prevWeekStart, lt: weekStart },
        },
      });

      const startTodayForAgents = new Date(Number(todayStart));
      const agentsActiveToday = await prisma.agent.count({
        where: {
          orgId,
          OR: [
            { lastActive: { gte: startTodayForAgents } },
            {
              actionLogs: {
                some: { timestampMs: { gte: todayStart, lt: tomorrowStart } },
              },
            },
          ],
        },
      });

      let actionsVsYesterdayPercent: number | null = null;
      if (actionsYesterday > 0) {
        actionsVsYesterdayPercent = Math.round(
          ((actionsToday - actionsYesterday) / actionsYesterday) * 100,
        );
      } else if (actionsToday > 0) {
        actionsVsYesterdayPercent = 100;
      }

      let actionsWeekOverWeekPercent: number | null = null;
      if (actionsPrevWeek > 0) {
        actionsWeekOverWeekPercent = Math.round(
          ((actionsThisWeek - actionsPrevWeek) / actionsPrevWeek) * 100,
        );
      } else if (actionsThisWeek > 0) {
        actionsWeekOverWeekPercent = 100;
      }

      const slicedAgents = agents.slice(0, 8);
      const slicedIds = slicedAgents.map((a) => a.id);
      const actionCountsToday =
        slicedIds.length > 0
          ? await prisma.actionLog.groupBy({
              by: ['agentId'],
              where: {
                agentId: { in: slicedIds },
                timestampMs: { gte: todayStart, lt: tomorrowStart },
              },
              _count: { id: true },
            })
          : [];
      const actionsTodayByAgent = new Map(actionCountsToday.map((r) => [r.agentId, r._count.id]));

      const auditLogs = await prisma.actionLog.findMany({
        where: { agent: { orgId } },
        orderBy: { timestampMs: 'desc' },
        take: 15,
        include: { agent: true },
      });

      const auditEvents = auditLogs.map((log) => {
        const ms = Number(log.timestampMs);
        const d = new Date(ms);
        const hh = `${d.getUTCHours()}`.padStart(2, '0');
        const mm = `${d.getUTCMinutes()}`.padStart(2, '0');
        const ss = `${d.getUTCSeconds()}`.padStart(2, '0');
        return {
          id: log.id,
          timeUtc: `${hh}:${mm}:${ss}`,
          agentName: log.agent?.name ?? 'Deleted agent',
          action: normalizeAuditAction(log.actionType),
          result: normalizeAuditResult(log.status),
          description: describeAuditPayload(log.payload, log.actionType),
        };
      });

      const agentRows = slicedAgents.map((a) => {
        const presence = deriveAgentPresence(a.lastActive);
        return {
          id: a.id,
          name: a.name,
          didShort: truncateDid(a.did),
          actionsToday: actionsTodayByAgent.get(a.id) ?? 0,
          status:
            presence === 'online' ? ('online' as const) : presence === 'idle' ? ('idle' as const) : ('offline' as const),
          statusDetail: formatRelativeLastActive(a.lastActive),
        };
      });

      response.json({
        workspaceKind,
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          workspaceKind,
        },
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        },
        metrics:
          workspaceKind === 'organization'
            ? {
                kind: 'organization' as const,
                registeredAgents: agentCount,
                agentsActiveToday,
                actionsThisWeek,
                actionsWeekOverWeekPercent,
                policyViolations: 0,
              }
            : {
                kind: 'individual' as const,
                activeAgents: agentCount,
                agentsOnline,
                actionsToday,
                actionsVsYesterdayPercent,
                credentialsValid: 0,
              },
        agents: agentRows,
        auditEvents,
      });
    } catch (error) {
      console.error('[dashboard/home]', error);
      response
        .status(500)
        .json({ error: { code: 'internal_error', message: 'Failed to load dashboard' } });
    }
  });

  /**
   * Full audit log for the caller's org, grouped by agent. Newest events first
   * both within each group and when ordering the groups themselves.
   */
  router.get('/audit', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;

      const rawLimit = Number.parseInt(String(request.query.limit ?? ''), 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 2000) : 1000;

      const logs = await prisma.actionLog.findMany({
        where: { agent: { orgId } },
        orderBy: { timestampMs: 'desc' },
        take: limit,
        include: { agent: { select: { id: true, name: true, did: true, agentKind: true } } },
      });

      type AuditGroup = {
        agentId: string;
        agentName: string;
        didShort: string;
        agentKind: string;
        latestTimestampMs: number;
        events: Array<{
          id: string;
          timestampMs: number;
          timeUtc: string;
          dateUtc: string;
          actionType: string;
          action: 'READ' | 'WRITE' | 'AUTH';
          result: 'Success' | 'Blocked' | 'Flagged';
          riskLevel: 'low' | 'medium' | 'high';
          approvalStatus: string;
          surface: string | null;
          description: string;
        }>;
      };

      const groups = new Map<string, AuditGroup>();

      for (const log of logs) {
        // The `where: { agent: { orgId } }` filter above already excludes logs whose
        // Agent row is gone (SetNull on delete) — this is belt-and-suspenders.
        if (!log.agentId || !log.agent) continue;

        const ms = Number(log.timestampMs);
        const d = new Date(ms);
        const hh = `${d.getUTCHours()}`.padStart(2, '0');
        const mm = `${d.getUTCMinutes()}`.padStart(2, '0');
        const ss = `${d.getUTCSeconds()}`.padStart(2, '0');
        const yyyy = d.getUTCFullYear();
        const mon = `${d.getUTCMonth() + 1}`.padStart(2, '0');
        const day = `${d.getUTCDate()}`.padStart(2, '0');

        let group = groups.get(log.agentId);
        if (!group) {
          group = {
            agentId: log.agentId,
            agentName: log.agent.name,
            didShort: truncateDid(log.agent.did),
            agentKind: log.agent.agentKind ?? 'standard',
            latestTimestampMs: ms,
            events: [],
          };
          groups.set(log.agentId, group);
        }
        if (ms > group.latestTimestampMs) group.latestTimestampMs = ms;

        group.events.push({
          id: log.id,
          timestampMs: ms,
          timeUtc: `${hh}:${mm}:${ss}`,
          dateUtc: `${yyyy}-${mon}-${day}`,
          actionType: log.actionType,
          action: normalizeAuditAction(log.actionType),
          result: normalizeAuditResult(log.status),
          riskLevel: normalizeRiskLevel(log.riskLevel),
          approvalStatus: log.approvalStatus,
          surface: readAuditSurface(log.payload),
          description: describeAuditPayload(log.payload, log.actionType),
        });
      }

      const grouped = Array.from(groups.values()).sort(
        (a, b) => b.latestTimestampMs - a.latestTimestampMs,
      );

      response.json({
        totalEvents: logs.length,
        limit,
        truncated: logs.length >= limit,
        groups: grouped.map((g) => ({
          agentId: g.agentId,
          agentName: g.agentName,
          didShort: g.didShort,
          agentKind: g.agentKind,
          eventCount: g.events.length,
          events: g.events,
        })),
      });
    } catch (error) {
      console.error('[dashboard/audit]', error);
      response
        .status(500)
        .json({ error: { code: 'internal_error', message: 'Failed to load audit log' } });
    }
  });

  return router;
}
