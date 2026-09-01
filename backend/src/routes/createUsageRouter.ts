import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { assertCanViewBilling } from '../lib/billingAccess.js';
import { billingCycleFromDateUtc } from '../billings/lib/billingCycle.js';
import { Prisma } from '@prisma/client';
import {
  PROMPT_ATTRIBUTION_TARGET,
  assignMissingTeamAttempts,
  attributePromptTokens,
  extractTeamDispatch,
  groupTeamTokensByStageAttempt,
  summarizePromptAttribution,
} from './usageAttribution.js';
import { summarizeSuccessQuality } from './executionQuality.js';

const summaryQuerySchema = z.object({
  billingCycle: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const agentUsageQuerySchema = z.object({
  billingCycle: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

const detailedUsageQuerySchema = z.object({
  billingCycle: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  take: z.coerce.number().int().min(1).max(500).default(250),
});

type UsageRoundDetail = {
  round: number;
  estimatedInputTokens: number;
  messageTokens: number;
  toolsSchemaTokens: number;
  retainedToolChars: number;
  components?: Record<string, number>;
};

type UsageEventDetails = {
  cachedPromptTokens: number;
  upstreamInferenceCostUsd: number | null;
  roundCount: number;
  peakRequestTokens: number | null;
  estimatedInputTokens: number | null;
  toolsSchemaTokens: number | null;
  rounds: UsageRoundDetail[];
  components?: Record<string, number>;
};

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key, finiteNumber(item)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] != null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function resolveUsageProvider(provider: string | null, model: string | null): string | null {
  const explicit = provider?.trim();
  if (explicit) return explicit;
  const prefix = model?.trim().split('/', 1)[0]?.toLowerCase();
  return prefix && ['openrouter', 'exora', 'openai', 'anthropic', 'google'].includes(prefix)
    ? prefix
    : null;
}

export function extractUsageEventDetails(
  events: Array<{ seq: number; data: unknown }>,
): UsageEventDetails {
  let cachedPromptTokens = 0;
  let upstreamInferenceCostUsd: number | null = null;
  let roundCount = 0;
  let peakRequestTokens: number | null = null;
  let estimatedInputTokens: number | null = null;
  let toolsSchemaTokens: number | null = null;
  let components: Record<string, number> | undefined;
  const rounds: UsageRoundDetail[] = [];

  for (const event of events.sort((a, b) => a.seq - b.seq)) {
    if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) continue;
    const data = event.data as Record<string, unknown>;
    if (data.message === 'inference_success') {
      const usage = data.usage;
      if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
        const usageRecord = usage as Record<string, unknown>;
        const promptDetails = usageRecord.prompt_tokens_details;
        if (promptDetails && typeof promptDetails === 'object' && !Array.isArray(promptDetails)) {
          cachedPromptTokens = finiteNumber((promptDetails as Record<string, unknown>).cached_tokens) ?? 0;
        }
        const costDetails = usageRecord.cost_details;
        if (costDetails && typeof costDetails === 'object' && !Array.isArray(costDetails)) {
          upstreamInferenceCostUsd = finiteNumber(
            (costDetails as Record<string, unknown>).upstream_inference_cost,
          );
        }
      }
    } else if (data.message === 'context_size') {
      roundCount = finiteNumber(data.rounds) ?? roundCount;
      peakRequestTokens = finiteNumber(data.peakRequestTokens);
      estimatedInputTokens = finiteNumber(data.estimatedInputTokens);
      toolsSchemaTokens = finiteNumber(data.toolsSchemaTokens);
      cachedPromptTokens = finiteNumber(data.cachedPromptTokens) ?? cachedPromptTokens;
      components = numberRecord(data.components) ?? components;
    } else if (data.message === 'context_pack') {
      components = numberRecord(data.components) ?? components;
    } else if (data.message === 'context_size_round') {
      const round = finiteNumber(data.round);
      if (round == null) continue;
      const roundComponents = numberRecord(data.components);
      rounds.push({
        round,
        estimatedInputTokens: finiteNumber(data.estimatedInputTokens) ?? 0,
        messageTokens: finiteNumber(data.messageTokens) ?? 0,
        toolsSchemaTokens: finiteNumber(data.toolsSchemaTokens) ?? 0,
        retainedToolChars: finiteNumber(data.retainedToolChars) ?? 0,
        ...(roundComponents ? { components: roundComponents } : {}),
      });
      roundCount = Math.max(roundCount, round);
    }
  }

  return {
    cachedPromptTokens,
    upstreamInferenceCostUsd,
    roundCount,
    peakRequestTokens,
    estimatedInputTokens,
    toolsSchemaTokens,
    rounds,
    ...(components ? { components } : {}),
  };
}

type UsageBucket = {
  totalRuns: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCostUsd: Prisma.Decimal;
  snapshotName: string;
};

export function createUsageRouter(): Router {
  const router = Router();

  // Includes standard agent runs and Exa brain-query usage.

  router.use(authenticateUser(true));
  // Usage/cost data is billing-sensitive: org members/admins must not see it (owner-only in orgs).
  router.use(assertCanViewBilling);

  // GET /api/v1/usage/summary — agents grouped by durable agentKey for the workspace
  router.get('/summary', async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const query = summaryQuerySchema.parse(request.query);
      const billingCycle = query.billingCycle ?? billingCycleFromDateUtc(new Date());
      const [year, month] = billingCycle.split('-').map(Number);
      const cycleStart = new Date(Date.UTC(year, month - 1, 1));
      const cycleEnd = new Date(Date.UTC(year, month, 1));

      // Determine scope: org or user
      const scopeFilter =
        auth.orgId && auth.orgId.length > 0
          ? { orgId: auth.orgId }
          : { userId: auth.userId };

      const cycleWhere = { ...scopeFilter, createdAt: { gte: cycleStart, lt: cycleEnd } };

      // Aggregate by durable agentKey so deleted agents still appear.
      const [runUsage, brainUsage, runNameRows, brainNameRows] = await Promise.all([
        prisma.runUsage.groupBy({
          by: ['agentKey'],
          where: cycleWhere,
          _count: { id: true },
          _sum: { promptTokens: true, completionTokens: true, totalTokens: true, totalCostUsd: true },
        }),
        prisma.brainUsage.groupBy({
          by: ['agentKey'],
          where: cycleWhere,
          _count: { id: true },
          _sum: { promptTokens: true, completionTokens: true, totalTokens: true, totalCostUsd: true },
        }),
        prisma.runUsage.findMany({
          where: cycleWhere,
          distinct: ['agentKey'],
          orderBy: { createdAt: 'desc' },
          select: { agentKey: true, agentName: true },
        }),
        prisma.brainUsage.findMany({
          where: cycleWhere,
          distinct: ['agentKey'],
          orderBy: { createdAt: 'desc' },
          select: { agentKey: true, agentName: true },
        }),
      ]);

      const totals = new Map<string, UsageBucket>();
      for (const row of runUsage) {
        totals.set(row.agentKey, {
          totalRuns: row._count.id,
          promptTokens: row._sum.promptTokens ?? 0,
          completionTokens: row._sum.completionTokens ?? 0,
          totalTokens: row._sum.totalTokens ?? 0,
          totalCostUsd: row._sum.totalCostUsd ?? new Prisma.Decimal('0'),
          snapshotName: row.agentKey,
        });
      }
      for (const row of brainUsage) {
        const previous = totals.get(row.agentKey);
        totals.set(row.agentKey, {
          totalRuns: (previous?.totalRuns ?? 0) + row._count.id,
          promptTokens: (previous?.promptTokens ?? 0) + (row._sum.promptTokens ?? 0),
          completionTokens: (previous?.completionTokens ?? 0) + (row._sum.completionTokens ?? 0),
          totalTokens: (previous?.totalTokens ?? 0) + (row._sum.totalTokens ?? 0),
          totalCostUsd: (previous?.totalCostUsd ?? new Prisma.Decimal('0')).add(
            row._sum.totalCostUsd ?? new Prisma.Decimal('0'),
          ),
          snapshotName: previous?.snapshotName ?? row.agentKey,
        });
      }

      const snapshotNames = new Map<string, string>();
      for (const row of [...brainNameRows, ...runNameRows]) {
        // Prefer the most recent run-usage name when both exist (runNameRows applied last
        // would win — iterate brain first then run so run names take precedence).
        if (row.agentName.trim()) snapshotNames.set(row.agentKey, row.agentName.trim());
      }
      for (const [key, bucket] of totals) {
        const snap = snapshotNames.get(key);
        if (snap) bucket.snapshotName = snap;
      }

      // Prefer live agent names when the agent still exists.
      const agentKeys = [...totals.keys()];
      const agents = await prisma.agent.findMany({
        where: { id: { in: agentKeys } },
        select: { id: true, name: true },
      });
      const liveNames = new Map(agents.map((a) => [a.id, a.name]));

      const summary = [...totals.entries()]
        .map(([agentId, row]) => {
          const live = liveNames.get(agentId);
          const agentName = live ?? `${row.snapshotName} (deleted)`;
          return {
            agentId,
            agentName,
            totalRuns: row.totalRuns,
            promptTokens: row.promptTokens,
            completionTokens: row.completionTokens,
            totalTokens: row.totalTokens,
            totalCostUsd: row.totalCostUsd.toString(),
          };
        })
        .sort((a, b) => b.totalRuns - a.totalRuns);

      response.json({ billingCycle, summary });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid query', details: error.flatten() } });
        return;
      }
      console.error('[usage/summary]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load usage summary' } });
    }
  });

  // GET /api/v1/usage/runs — detailed monthly usage grouped by durable agent identity.
  router.get('/runs', async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const query = detailedUsageQuerySchema.parse(request.query);
      const billingCycle = query.billingCycle ?? billingCycleFromDateUtc(new Date());
      const [year, month] = billingCycle.split('-').map(Number);
      const cycleStart = new Date(Date.UTC(year, month - 1, 1));
      const cycleEnd = new Date(Date.UTC(year, month, 1));
      const scopeFilter = auth.orgId && auth.orgId.length > 0
        ? { orgId: auth.orgId }
        : { userId: auth.userId };
      const where = { ...scopeFilter, createdAt: { gte: cycleStart, lt: cycleEnd } };

      const teamWhere = {
        createdAt: { gte: cycleStart, lt: cycleEnd },
        ...(auth.orgId && auth.orgId.length > 0
          ? { orgId: auth.orgId }
          : { startedByUserId: auth.userId }),
      };

      const [runRows, brainRows, agentRunRows, teamRunRows, mailboxRows] = await Promise.all([
        prisma.runUsage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: query.take + 1,
          select: {
            id: true,
            runId: true,
            agentKey: true,
            agentName: true,
            promptTokens: true,
            completionTokens: true,
            totalTokens: true,
            totalCostUsd: true,
            model: true,
            provider: true,
            openrouterGenId: true,
            createdAt: true,
            run: {
              select: {
                agentId: true,
                conversationId: true,
                status: true,
                createdAt: true,
                startedAt: true,
                finishedAt: true,
                teamRunId: true,
                teamId: true,
                teamRole: true,
                parentRunId: true,
                invocationKind: true,
                sourceChannel: true,
              },
            },
          },
        }),
        prisma.brainUsage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: query.take + 1,
          select: {
            id: true,
            agentKey: true,
            agentName: true,
            promptTokens: true,
            completionTokens: true,
            totalTokens: true,
            totalCostUsd: true,
            model: true,
            provider: true,
            createdAt: true,
          },
        }),
        prisma.agentRun.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          take: 2_000,
          select: {
            status: true,
            conversationId: true,
            createdAt: true,
            teamRunId: true,
            invocationKind: true,
          },
        }),
        prisma.teamRun.findMany({
          where: teamWhere,
          orderBy: { createdAt: 'asc' },
          take: 500,
          select: { id: true, status: true, artifacts: true, continuesRunId: true, createdAt: true },
        }),
        prisma.teamMailboxMessage.findMany({
          where: { kind: 'result', run: teamWhere },
          take: 2_000,
          select: { status: true },
        }),
      ]);

      const runIds = runRows.flatMap((row) => row.runId ? [row.runId] : []);
      const eventRows = runIds.length > 0
        ? await prisma.agentRunEvent.findMany({
            where: {
              runId: { in: runIds },
              type: 'log',
              OR: [
                { data: { path: ['message'], equals: 'inference_success' } },
                { data: { path: ['message'], equals: 'context_size' } },
                { data: { path: ['message'], equals: 'context_size_round' } },
                { data: { path: ['message'], equals: 'context_pack' } },
                { data: { path: ['message'], equals: 'team_dispatch' } },
              ],
            },
            orderBy: [{ runId: 'asc' }, { seq: 'asc' }],
            select: { runId: true, seq: true, data: true },
          })
        : [];
      const eventsByRun = new Map<string, Array<{ seq: number; data: unknown }>>();
      for (const event of eventRows) {
        const bucket = eventsByRun.get(event.runId) ?? [];
        bucket.push({ seq: event.seq, data: event.data });
        eventsByRun.set(event.runId, bucket);
      }

      const teamIds = [...new Set(runRows.flatMap((row) => (row.run?.teamId ? [row.run.teamId] : [])))];
      const members = teamIds.length > 0
        ? await prisma.teamMember.findMany({
            where: { teamId: { in: teamIds } },
            select: { teamId: true, agentId: true, stageOrder: true },
          })
        : [];
      const stageByMember = new Map(members.map((member) => [`${member.teamId}:${member.agentId}`, member.stageOrder]));

      const detailedRuns = assignMissingTeamAttempts([
        ...runRows.map((row) => {
          const details = extractUsageEventDetails(row.runId ? eventsByRun.get(row.runId) ?? [] : []);
          const dispatch = extractTeamDispatch(row.runId ? eventsByRun.get(row.runId) ?? [] : []);
          const startedAt = row.run?.startedAt ?? row.run?.createdAt ?? row.createdAt;
          const finishedAt = row.run?.finishedAt ?? null;
          const attribution = attributePromptTokens({
            promptTokens: row.promptTokens,
            components: details.components,
            rounds: details.rounds,
            runType: 'agent',
          });
          const stageOrder = dispatch.stageOrder
            ?? (row.run?.teamId && row.run.agentId ? stageByMember.get(`${row.run.teamId}:${row.run.agentId}`) ?? null : null);
          return {
            usageId: row.id,
            runType: 'agent' as const,
            agentId: row.agentKey,
            agentName: row.agentName,
            runAgentId: row.run?.agentId ?? row.agentKey,
            runId: row.runId,
            conversationId: row.run?.conversationId ?? null,
            teamRunId: row.run?.teamRunId ?? null,
            teamId: row.run?.teamId ?? null,
            teamRole: dispatch.teamRole ?? row.run?.teamRole ?? null,
            stageOrder,
            attempt: dispatch.attempt,
            parentRunId: row.run?.parentRunId ?? null,
            invocationKind: row.run?.invocationKind ?? null,
            sourceChannel: row.run?.sourceChannel ?? null,
            status: row.run?.status ?? 'deleted',
            createdAt: row.createdAt.toISOString(),
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt?.toISOString() ?? null,
            durationMs: finishedAt ? Math.max(0, finishedAt.getTime() - startedAt.getTime()) : null,
            model: row.model,
            provider: resolveUsageProvider(row.provider, row.model),
            generationId: row.openrouterGenId,
            promptTokens: row.promptTokens,
            cachedPromptTokens: details.cachedPromptTokens,
            completionTokens: row.completionTokens,
            totalTokens: row.totalTokens,
            providerCostUsd: row.totalCostUsd.toString(),
            upstreamInferenceCostUsd: details.upstreamInferenceCostUsd == null
              ? null
              : String(details.upstreamInferenceCostUsd),
            roundCount: details.roundCount,
            peakRequestTokens: details.peakRequestTokens,
            estimatedInputTokens: details.estimatedInputTokens,
            toolsSchemaTokens: details.toolsSchemaTokens,
            rounds: details.rounds,
            components: details.components ?? null,
            explainedTokens: attribution.explainedTokens,
            unexplainedTokens: attribution.unexplainedTokens,
            coverage: attribution.coverage,
            attribution: attribution.byComponent,
          };
        }),
        ...brainRows.map((row) => {
          const attribution = attributePromptTokens({
            promptTokens: row.promptTokens,
            runType: 'brain_query',
          });
          return {
            usageId: row.id,
            runType: 'brain_query' as const,
            agentId: row.agentKey,
            agentName: row.agentName,
            runAgentId: row.agentKey,
            runId: null,
            conversationId: null,
            teamRunId: null,
            teamId: null,
            teamRole: null,
            stageOrder: null as number | null,
            attempt: null as number | null,
            parentRunId: null,
            invocationKind: 'brain_query',
            sourceChannel: null,
            status: 'completed',
            createdAt: row.createdAt.toISOString(),
            startedAt: row.createdAt.toISOString(),
            finishedAt: null,
            durationMs: null,
            model: row.model,
            provider: resolveUsageProvider(row.provider, row.model),
            generationId: null,
            promptTokens: row.promptTokens,
            cachedPromptTokens: 0,
            completionTokens: row.completionTokens,
            totalTokens: row.totalTokens,
            providerCostUsd: row.totalCostUsd.toString(),
            upstreamInferenceCostUsd: null,
            roundCount: 1,
            peakRequestTokens: null,
            estimatedInputTokens: null,
            toolsSchemaTokens: null,
            rounds: [] as UsageRoundDetail[],
            components: attribution.byComponent,
            explainedTokens: attribution.explainedTokens,
            unexplainedTokens: attribution.unexplainedTokens,
            coverage: attribution.coverage,
            attribution: attribution.byComponent,
          };
        }),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((run) => ({
        ...run,
        rankAgentId: run.runAgentId,
      })));
      const publicRuns = detailedRuns.map(({ runAgentId: _runAgentId, rankAgentId: _rankAgentId, ...run }) => run);

      const truncated = publicRuns.length > query.take;
      const selectedRuns = publicRuns.slice(0, query.take);
      const attribution = summarizePromptAttribution(selectedRuns.map((run) => ({
        promptTokens: run.promptTokens,
        explainedTokens: run.explainedTokens,
        unexplainedTokens: run.unexplainedTokens,
        coverage: run.coverage,
        byComponent: run.attribution,
        meetsTarget: run.coverage >= PROMPT_ATTRIBUTION_TARGET,
      })));
      const teams = groupTeamTokensByStageAttempt(selectedRuns);
      const quality = summarizeSuccessQuality({
        runStatuses: [...agentRunRows.map((row) => row.status), ...teamRunRows.map((row) => row.status)],
        mailboxStatuses: mailboxRows.map((row) => row.status),
        artifactLists: teamRunRows.map((row) => row.artifacts),
        retryRuns: [
          ...agentRunRows.map((row) => ({
            conversationId: row.conversationId,
            createdAt: row.createdAt,
            status: row.status,
            teamRunId: row.teamRunId,
            invocationKind: row.invocationKind,
          })),
          ...teamRunRows.map((row) => ({
            conversationId: row.id,
            createdAt: row.createdAt,
            status: row.status,
            continuesRunId: row.continuesRunId,
          })),
        ],
      });
      const groups = new Map<string, {
        agentId: string;
        agentName: string;
        totalRuns: number;
        promptTokens: number;
        cachedPromptTokens: number;
        completionTokens: number;
        totalTokens: number;
        providerCostUsd: Prisma.Decimal;
        runs: typeof selectedRuns;
      }>();
      for (const run of selectedRuns) {
        const current = groups.get(run.agentId) ?? {
          agentId: run.agentId,
          agentName: run.agentName,
          totalRuns: 0,
          promptTokens: 0,
          cachedPromptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          providerCostUsd: new Prisma.Decimal(0),
          runs: [],
        };
        current.totalRuns += 1;
        current.promptTokens += run.promptTokens;
        current.cachedPromptTokens += run.cachedPromptTokens;
        current.completionTokens += run.completionTokens;
        current.totalTokens += run.totalTokens;
        current.providerCostUsd = current.providerCostUsd.add(run.providerCostUsd);
        current.runs.push(run);
        groups.set(run.agentId, current);
      }

      response.json({
        billingCycle,
        truncated,
        attribution: {
          ...attribution,
          target: PROMPT_ATTRIBUTION_TARGET,
        },
        quality,
        teams,
        groups: [...groups.values()]
          .map((group) => ({ ...group, providerCostUsd: group.providerCostUsd.toString() }))
          .sort((a, b) => b.totalTokens - a.totalTokens),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid query', details: error.flatten() } });
        return;
      }
      console.error('[usage/runs]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load detailed usage' } });
    }
  });

  // GET /api/v1/usage/agents/:agentId — per-run breakdown (works for deleted agents via agentKey)
  router.get('/agents/:agentId', async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const agentId = String(request.params.agentId);
      const query = agentUsageQuerySchema.parse(request.query);

      // Determine scope: org or user
      const scopeFilter =
        auth.orgId && auth.orgId.length > 0
          ? { orgId: auth.orgId }
          : { userId: auth.userId };

      const [year, month] = (query.billingCycle ?? billingCycleFromDateUtc(new Date()))
        .split('-')
        .map(Number);
      const cycleStart = new Date(Date.UTC(year, month - 1, 1));
      const cycleEnd = new Date(Date.UTC(year, month, 1));

      // Authorize from usage rows (or live agent) so deleted agents remain readable.
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { orgId: true, userId: true, name: true },
      });

      if (agent) {
        const owns = scopeFilter.orgId ? agent.orgId === auth.orgId : agent.userId === auth.userId;
        if (!owns) {
          response.status(403).json({ error: { code: 'forbidden', message: 'Forbidden' } });
          return;
        }
      } else {
        const sample = await prisma.runUsage.findFirst({
          where: { agentKey: agentId, ...scopeFilter },
          select: { id: true },
        });
        const brainSample =
          sample ??
          (await prisma.brainUsage.findFirst({
            where: { agentKey: agentId, ...scopeFilter },
            select: { id: true },
          }));
        if (!brainSample) {
          response.status(404).json({ error: { code: 'not_found', message: 'Agent usage not found' } });
          return;
        }
      }

      const rows = await prisma.runUsage.findMany({
        where: {
          agentKey: agentId,
          ...scopeFilter,
          createdAt: { gte: cycleStart, lt: cycleEnd },
        },
        orderBy: { createdAt: 'desc' },
        take: query.take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : null),
        select: {
          id: true,
          runId: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          totalCostUsd: true,
          model: true,
          createdAt: true,
          run: { select: { conversationId: true } },
        },
      });

      const hasMore = rows.length > query.take;
      const slice = hasMore ? rows.slice(0, query.take) : rows;
      const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;

      response.json({
        agentId,
        nextCursor,
        runs: slice.map((r) => ({
          runId: r.runId,
          conversationId: r.run?.conversationId ?? null,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
          totalTokens: r.totalTokens,
          totalCostUsd: r.totalCostUsd.toString(),
          model: r.model,
          createdAt: r.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid query', details: error.flatten() } });
        return;
      }
      console.error('[usage/agents/:agentId]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load agent usage' } });
    }
  });

  return router;
}
