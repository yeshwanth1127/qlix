import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { assertInternalServiceSecret } from '../middleware/assertInternalServiceSecret.js';
import { prisma } from '../lib/prisma.js';
import {
  ScheduleForbiddenError,
  ScheduleNotFoundError,
  ScheduleValidationError,
  scheduleService,
} from '../schedules/schedule.service.js';

async function resolveAgentContext(agentId: string): Promise<{
  orgId: string;
  userId: string;
  agentId: string;
} | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, userId: true, orgId: true, user: { select: { orgId: true } } },
  });
  if (!agent) return null;
  const orgId = agent.orgId ?? agent.user.orgId;
  return { orgId, userId: agent.userId, agentId: agent.id };
}

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
  targetAgentId: z.string().optional(),
  payloadJson: z.unknown().optional(),
});

export function createInternalSchedulesRouter(): Router {
  const router = Router();
  router.use(assertInternalServiceSecret);

  router.get('/agent/:agentId/context', async (request: Request, response: Response) => {
    const ctx = await resolveAgentContext(request.params.agentId);
    if (!ctx) {
      response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
      return;
    }
    response.json(ctx);
  });

  router.post('/', async (request: Request, response: Response) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid schedule payload' } });
      return;
    }
    const ctx = await resolveAgentContext(parsed.data.agentId);
    if (!ctx) {
      response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
      return;
    }
    try {
      const schedule = await scheduleService.create({
        orgId: ctx.orgId,
        agentId: parsed.data.targetAgentId?.trim() || ctx.agentId,
        createdByAgentId: ctx.agentId,
        createdByUserId: ctx.userId,
        scheduleType: parsed.data.scheduleType,
        cronExpression: parsed.data.cronExpression,
        onceAt: parsed.data.onceAt,
        intervalSeconds: parsed.data.intervalSeconds,
        prompt: parsed.data.prompt,
        label: parsed.data.label,
        maxRuns: parsed.data.maxRuns,
        payloadJson: parsed.data.payloadJson as never,
        source: 'mcp',
        restrictToCallerAgent: true,
      });
      response.status(201).json({ schedule });
    } catch (err) {
      if (mapError(err, response)) return;
      throw err;
    }
  });

  router.get('/', async (request: Request, response: Response) => {
    const agentId = String(request.query.agentId ?? '').trim();
    if (!agentId) {
      response.status(400).json({ error: { code: 'invalid_query', message: 'agentId is required' } });
      return;
    }
    const ctx = await resolveAgentContext(agentId);
    if (!ctx) {
      response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
      return;
    }
    const status = typeof request.query.status === 'string' ? request.query.status : null;
    const includeCancelled = request.query.includeCancelled === '1' || request.query.includeCancelled === 'true';
    const schedules = await scheduleService.list({
      orgId: ctx.orgId,
      agentId: ctx.agentId,
      status,
      includeCancelled,
    });
    // Also include schedules this agent created for itself (same agentId filter covers both).
    response.json({ schedules });
  });

  router.get('/:scheduleId', async (request: Request, response: Response) => {
    const agentId = String(request.query.agentId ?? '').trim();
    if (!agentId) {
      response.status(400).json({ error: { code: 'invalid_query', message: 'agentId is required' } });
      return;
    }
    const ctx = await resolveAgentContext(agentId);
    if (!ctx) {
      response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
      return;
    }
    try {
      const schedule = await scheduleService.get(ctx.orgId, String(request.params.scheduleId));
      if (schedule.agentId !== ctx.agentId && schedule.createdByAgentId !== ctx.agentId) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed' } });
        return;
      }
      response.json({ schedule });
    } catch (err) {
      if (mapError(err, response)) return;
      throw err;
    }
  });

  router.patch('/:scheduleId', async (request: Request, response: Response) => {
    const parsed = z
      .object({
        agentId: z.string().min(1),
        label: z.string().max(120).nullable().optional(),
        prompt: z.string().min(1).max(4000).optional(),
        cronExpression: z.string().optional(),
        onceAt: z.string().optional(),
        intervalSeconds: z.number().int().optional(),
        enabled: z.boolean().optional(),
        status: z.enum(['active', 'paused']).optional(),
        maxRuns: z.number().int().nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid update payload' } });
      return;
    }
    const ctx = await resolveAgentContext(parsed.data.agentId);
    if (!ctx) {
      response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
      return;
    }
    try {
      const { agentId: _a, ...patch } = parsed.data;
      const schedule = await scheduleService.update(ctx.orgId, String(request.params.scheduleId), patch, {
        callerAgentId: ctx.agentId,
      });
      response.json({ schedule });
    } catch (err) {
      if (mapError(err, response)) return;
      throw err;
    }
  });

  router.post('/:scheduleId/cancel', async (request: Request, response: Response) => {
    const parsed = z.object({ agentId: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'agentId is required' } });
      return;
    }
    const ctx = await resolveAgentContext(parsed.data.agentId);
    if (!ctx) {
      response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
      return;
    }
    try {
      const schedule = await scheduleService.cancel(ctx.orgId, String(request.params.scheduleId), {
        callerAgentId: ctx.agentId,
      });
      response.json({ schedule });
    } catch (err) {
      if (mapError(err, response)) return;
      throw err;
    }
  });

  return router;
}
