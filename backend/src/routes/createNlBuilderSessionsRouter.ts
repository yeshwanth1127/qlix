import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { prisma } from '../lib/prisma.js';

const SESSION_LIMIT = 50;

const createSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  transcript: z.array(z.unknown()).max(500).optional(),
  createdAgentIds: z.array(z.string().min(1).max(80)).max(50).optional(),
  teamId: z.string().min(1).max(80).nullable().optional(),
});

function serializeSession<T extends {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  createdAgentIds: string[];
  teamId: string | null;
  transcript?: unknown;
}>(row: T) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdAgentIds: row.createdAgentIds,
    teamId: row.teamId,
    ...(row.transcript !== undefined ? { transcript: row.transcript } : {}),
  };
}

export function createNlBuilderSessionsRouter(): Router {
  const router = Router();

  router.use(authenticateUser(true));

  router.get('/', async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const orgId = req.auth!.orgId;
      const sessions = await prisma.nlBuilderSession.findMany({
        where: { userId, orgId },
        orderBy: { updatedAt: 'desc' },
        take: SESSION_LIMIT,
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          createdAgentIds: true,
          teamId: true,
        },
      });
      res.json({ sessions: sessions.map(serializeSession) });
    } catch (err) {
      console.error('nl-builder/sessions:get', err);
      res.status(500).json({ error: { code: 'sessions_failed', message: 'Failed to load builder history' } });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const parsed = createSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_body', message: 'Invalid session payload' } });
        return;
      }
      const session = await prisma.nlBuilderSession.create({
        data: {
          userId: req.auth!.userId,
          orgId: req.auth!.orgId,
          title: parsed.data.title?.slice(0, 160) || 'New chat',
          transcript: [],
        },
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          createdAgentIds: true,
          teamId: true,
          transcript: true,
        },
      });
      res.status(201).json({ session: serializeSession(session) });
    } catch (err) {
      console.error('nl-builder/sessions:post', err);
      res.status(500).json({ error: { code: 'session_create_failed', message: 'Failed to create chat' } });
    }
  });

  router.get('/:sessionId', async (req: Request, res: Response) => {
    try {
      const session = await prisma.nlBuilderSession.findFirst({
        where: {
          id: String(req.params.sessionId),
          userId: req.auth!.userId,
          orgId: req.auth!.orgId,
        },
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          createdAgentIds: true,
          teamId: true,
          transcript: true,
        },
      });
      if (!session) {
        res.status(404).json({ error: { code: 'not_found', message: 'Chat not found' } });
        return;
      }
      res.json({ session: serializeSession(session) });
    } catch (err) {
      console.error('nl-builder/sessions:getOne', err);
      res.status(500).json({ error: { code: 'session_failed', message: 'Failed to load chat' } });
    }
  });

  router.patch('/:sessionId', async (req: Request, res: Response) => {
    try {
      const parsed = updateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_body', message: 'Invalid session update' } });
        return;
      }
      const existing = await prisma.nlBuilderSession.findFirst({
        where: {
          id: String(req.params.sessionId),
          userId: req.auth!.userId,
          orgId: req.auth!.orgId,
        },
        select: { id: true },
      });
      if (!existing) {
        res.status(404).json({ error: { code: 'not_found', message: 'Chat not found' } });
        return;
      }

      const data: Prisma.NlBuilderSessionUpdateInput = {};
      if (parsed.data.title !== undefined) data.title = parsed.data.title.slice(0, 160);
      if (parsed.data.transcript !== undefined) {
        data.transcript = parsed.data.transcript as Prisma.InputJsonValue;
      }
      if (parsed.data.createdAgentIds !== undefined) data.createdAgentIds = parsed.data.createdAgentIds;
      if (parsed.data.teamId !== undefined) data.teamId = parsed.data.teamId;

      const session = await prisma.nlBuilderSession.update({
        where: { id: existing.id },
        data,
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          createdAgentIds: true,
          teamId: true,
          transcript: true,
        },
      });
      res.json({ session: serializeSession(session) });
    } catch (err) {
      console.error('nl-builder/sessions:patch', err);
      res.status(500).json({ error: { code: 'session_update_failed', message: 'Failed to save chat' } });
    }
  });

  router.delete('/:sessionId', async (req: Request, res: Response) => {
    try {
      const existing = await prisma.nlBuilderSession.findFirst({
        where: {
          id: String(req.params.sessionId),
          userId: req.auth!.userId,
          orgId: req.auth!.orgId,
        },
        select: { id: true },
      });
      if (!existing) {
        res.status(404).json({ error: { code: 'not_found', message: 'Chat not found' } });
        return;
      }
      await prisma.nlBuilderSession.delete({ where: { id: existing.id } });
      res.status(204).end();
    } catch (err) {
      console.error('nl-builder/sessions:delete', err);
      res.status(500).json({ error: { code: 'session_delete_failed', message: 'Failed to delete chat' } });
    }
  });

  return router;
}
