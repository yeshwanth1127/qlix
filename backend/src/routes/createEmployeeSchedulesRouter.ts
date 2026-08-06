import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import { nextCronApprox } from '../employees/employeeSchedule.service.js';

const createSchema = z.object({
  agentId: z.string().min(1),
  engagementId: z.string().optional(),
  cronExpression: z.string().trim().min(5).max(64),
  label: z.string().trim().max(120).optional(),
  prompt: z.string().trim().min(1).max(4000),
  enabled: z.boolean().optional(),
});

export function createEmployeeSchedulesRouter(): Router {
  const router = Router();

  router.get('/', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    const schedules = await prisma.employeeSchedule.findMany({
      where: { orgId: req.auth!.orgId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ schedules });
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
    const schedule = await prisma.employeeSchedule.create({
      data: {
        orgId: req.auth!.orgId,
        agentId: agent.id,
        engagementId: parsed.data.engagementId ?? null,
        cronExpression: parsed.data.cronExpression,
        label: parsed.data.label ?? null,
        prompt: parsed.data.prompt,
        enabled: parsed.data.enabled ?? true,
        nextRunAt: nextCronApprox(parsed.data.cronExpression),
      },
    });
    res.status(201).json({ schedule });
  });

  router.patch('/:id', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    const existing = await prisma.employeeSchedule.findFirst({
      where: { id: String(req.params.id), orgId: req.auth!.orgId },
    });
    if (!existing) {
      res.status(404).json({ error: { code: 'not_found', message: 'Schedule not found' } });
      return;
    }
    const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined;
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : undefined;
    const cronExpression =
      typeof req.body?.cronExpression === 'string' ? req.body.cronExpression : undefined;
    const schedule = await prisma.employeeSchedule.update({
      where: { id: existing.id },
      data: {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(prompt !== undefined ? { prompt } : {}),
        ...(cronExpression
          ? { cronExpression, nextRunAt: nextCronApprox(cronExpression) }
          : {}),
      },
    });
    res.json({ schedule });
  });

  router.delete('/:id', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    const existing = await prisma.employeeSchedule.findFirst({
      where: { id: String(req.params.id), orgId: req.auth!.orgId },
    });
    if (!existing) {
      res.status(404).json({ error: { code: 'not_found', message: 'Schedule not found' } });
      return;
    }
    await prisma.employeeSchedule.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  });

  return router;
}
