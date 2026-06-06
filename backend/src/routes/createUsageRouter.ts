import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { billingCycleFromDateUtc } from '../billings/lib/billingCycle.js';
import { Prisma } from '@prisma/client';

const summaryQuerySchema = z.object({
  billingCycle: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const agentUsageQuerySchema = z.object({
  billingCycle: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export function createUsageRouter(): Router {
  const router = Router();

  router.use(authenticateUser(true));

  // GET /api/v1/usage/summary — agents grouped by agentId for the workspace
  router.get('/summary', async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const query = summaryQuerySchema.parse(request.query);
      const billingCycle = query.billingCycle ?? billingCycleFromDateUtc(new Date());

      // Determine scope: org or user
      const scopeFilter =
        auth.orgId && auth.orgId.length > 0
          ? { orgId: auth.orgId }
          : { userId: auth.userId };

      // Aggregate by agentId
      const byAgent = await prisma.runUsage.groupBy({
        by: ['agentId'],
        where: scopeFilter,
        _count: { id: true },
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true, totalCostUsd: true },
        orderBy: { _count: { id: 'desc' } },
      });

      // Fetch agent names
      const agentIds = byAgent.map((a) => a.agentId);
      const agents = await prisma.agent.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, name: true },
      });
      const agentMap = new Map(agents.map((a) => [a.id, a.name]));

      const summary = byAgent.map((row) => ({
        agentId: row.agentId,
        agentName: agentMap.get(row.agentId) ?? row.agentId,
        totalRuns: row._count.id,
        promptTokens: row._sum.promptTokens ?? 0,
        completionTokens: row._sum.completionTokens ?? 0,
        totalTokens: row._sum.totalTokens ?? 0,
        totalCostUsd: (row._sum.totalCostUsd ?? new Prisma.Decimal('0')).toString(),
      }));

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

  // GET /api/v1/usage/agents/:agentId — per-run breakdown for a specific agent
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

      // Check agent ownership
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { orgId: true, userId: true },
      });
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }

      const owns = scopeFilter.orgId ? agent.orgId === auth.orgId : agent.userId === auth.userId;
      if (!owns) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Forbidden' } });
        return;
      }

      // Fetch runs for this agent
      const rows = await prisma.runUsage.findMany({
        where: { agentId },
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
          conversationId: r.run.conversationId,
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
