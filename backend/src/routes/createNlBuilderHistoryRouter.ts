import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticateUser, loadJwtSecret } from '../middleware/authenticateUser.js';
import { prisma } from '../lib/prisma.js';

const HISTORY_LIMIT = 20;

const saveSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
});

export function createNlBuilderHistoryRouter(): Router {
  const router = Router();
  const jwtSecret = loadJwtSecret();

  router.use(authenticateUser(true));

  router.get('/', async (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const entries = await prisma.nlBuilderHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { id: true, prompt: true, createdAt: true },
    });
    res.json({ entries });
  });

  router.post('/', async (req: Request, res: Response) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'prompt is required (max 2000 chars)' } });
      return;
    }
    const userId = req.auth!.userId;
    const { prompt } = parsed.data;

    // Remove any existing identical prompt so re-inserting bumps it to the top
    await prisma.nlBuilderHistory.deleteMany({ where: { userId, prompt } });
    await prisma.nlBuilderHistory.create({ data: { userId, prompt } });

    // Prune to HISTORY_LIMIT entries
    const toKeep = await prisma.nlBuilderHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { id: true },
    });
    if (toKeep.length === HISTORY_LIMIT) {
      await prisma.nlBuilderHistory.deleteMany({
        where: { userId, id: { notIn: toKeep.map((r) => r.id) } },
      });
    }

    res.status(201).json({ ok: true });
  });

  return router;
}
