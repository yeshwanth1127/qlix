import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import { prisma } from '../lib/prisma.js';
import {
  ScheduleForbiddenError,
  ScheduleNotFoundError,
  ScheduleValidationError,
  scheduleService,
} from '../schedules/schedule.service.js';

function mapError(err: unknown, response: Response): boolean {
  if (err instanceof ScheduleValidationError) {
    response.status(400).json({ error: { code: err.code, message: err.message } });
    return true;
  }
  if (err instanceof ScheduleNotFoundError) {
    response.status(404).json({ error: { code: err.code, message: err.message } });
    return true;
  }
  if (err instanceof ScheduleForbiddenError) {
    response.status(403).json({ error: { code: err.code, message: err.message } });
    return true;
  }
  return false;
}

const createSchema = z.object({
  agentId: z.string().min(1),
  scheduleType: z.enum(['cron', 'once', 'interval']),
  cronExpression: z.string().optional(),
  onceAt: z.string().optional(),
  intervalSeconds: z.number().int().optional(),
  prompt: z.string().min(1).max(4000),
  label: z.string().max(120).optional(),
  maxRuns: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

export function createSchedulesRouter(): Router {
  const router = Router();

  router.get('/', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
    const schedules = await scheduleService.list({
      orgId: req.auth!.orgId,
      agentId,
      includeCancelled: req.query.includeCancelled === '1' || req.query.includeCancelled === 'true',
    });
    const agentIds = [...new Set(schedules.map((s) => s.agentId))];
    const agents =
      agentIds.length === 0
        ? []
        : await prisma.agent.findMany({
            where: { id: { in: agentIds } },
            select: { id: true, name: true, status: true },
          });
    const byId = new Map(agents.map((a) => [a.id, a]));
    res.json({
      schedules: schedules.map((s) => {
        const agent = byId.get(s.agentId);
        return {
          ...s,
          agentName: agent?.name ?? null,
          agentStatus: agent?.status ?? null,
        };
      }),
    });
  });

  router.post('/', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'Invalid schedule payload' } });
      return;
    }
    const agent = await prisma.agent.findFirst({
      where: {
        id: parsed.data.agentId,
        OR: [{ orgId: req.auth!.orgId }, { userId: req.auth!.userId }],
      },
      select: { id: true },
    });
    if (!agent) {
      res.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
      return;
    }
    try {
      const schedule = await scheduleService.create({
        orgId: req.auth!.orgId,
        agentId: agent.id,
        createdByUserId: req.auth!.userId,
        scheduleType: parsed.data.scheduleType,
        cronExpression: parsed.data.cronExpression,
        onceAt: parsed.data.onceAt,
        intervalSeconds: parsed.data.intervalSeconds,
        prompt: parsed.data.prompt,
        label: parsed.data.label,
        maxRuns: parsed.data.maxRuns,
        enabled: parsed.data.enabled,
        source: 'console',
      });
      res.status(201).json({ schedule });
    } catch (err) {
      if (mapError(err, res)) return;
      throw err;
    }
  });

  router.patch('/:id', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    const parsed = z
      .object({
        label: z.string().max(120).nullable().optional(),
        prompt: z.string().min(1).max(4000).optional(),
        cronExpression: z.string().optional(),
        onceAt: z.string().optional(),
        intervalSeconds: z.number().int().optional(),
        enabled: z.boolean().optional(),
        status: z.enum(['active', 'paused']).optional(),
        maxRuns: z.number().int().nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'Invalid update payload' } });
      return;
    }
    try {
      const schedule = await scheduleService.update(req.auth!.orgId, String(req.params.id), parsed.data);
      res.json({ schedule });
    } catch (err) {
      if (mapError(err, res)) return;
      throw err;
    }
  });

  router.delete('/:id', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    try {
      const schedule = await scheduleService.cancel(req.auth!.orgId, String(req.params.id));
      res.json({ ok: true, schedule });
    } catch (err) {
      if (mapError(err, res)) return;
      throw err;
    }
  });

  return router;
}
