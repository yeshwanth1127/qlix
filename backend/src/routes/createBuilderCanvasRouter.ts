import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import { prisma } from '../lib/prisma.js';

/**
 * Saved Visual Builder canvases.
 *
 * A canvas is a *draft*: it records what the user drew, and nothing here creates agents,
 * grants scopes, or assembles teams. Deployment is a separate, explicit step.
 *
 * Canvases are org-scoped like teams — everyone in the workspace can see them, and only the
 * creator (or an owner/admin) can change or delete one.
 */

/** Rough ceiling on the stored graph so a runaway client can't write unbounded JSON. */
const MAX_GRAPH_BYTES = 512 * 1024;

const nameSchema = z.string().trim().min(1).max(120);

/**
 * The graph is passed through rather than fully modelled: node/edge shapes belong to the
 * canvas UI and will keep moving. `version` lets a future reader migrate old rows.
 */
const graphSchema = z
  .object({
    version: z.number().int().min(1),
    nodes: z.array(z.record(z.string(), z.unknown())).max(500),
    edges: z.array(z.record(z.string(), z.unknown())).max(1000),
    groups: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
    viewport: z
      .object({ x: z.number(), y: z.number(), zoom: z.number() })
      .optional(),
  })
  .refine((graph) => Buffer.byteLength(JSON.stringify(graph), 'utf8') <= MAX_GRAPH_BYTES, {
    message: 'Canvas is too large to save',
  });

const createSchema = z.object({ name: nameSchema });

const patchSchema = z
  .object({ name: nameSchema.optional(), graph: graphSchema.optional() })
  .refine((body) => body.name != null || body.graph != null, {
    message: 'name or graph is required',
  });

function canManage(createdByUserId: string, userId: string, role: string): boolean {
  return createdByUserId === userId || role === 'owner' || role === 'admin';
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: { code: 'invalid_body', message } });
}

export function createBuilderCanvasRouter(): Router {
  const router = Router();

  router.use(authenticateUser(true), requireSubscriptionAccess);

  /** List — deliberately omits `graph`, which is large and unused by the list UI. */
  router.get('/', async (req: Request, res: Response) => {
    const canvases = await prisma.builderCanvas.findMany({
      where: { orgId: req.auth!.orgId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json({ canvases });
  });

  router.post('/', async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, 'name is required (max 120 chars)');
      return;
    }
    const auth = req.auth!;
    const canvas = await prisma.builderCanvas.create({
      data: {
        orgId: auth.orgId,
        createdByUserId: auth.userId,
        name: parsed.data.name,
        graph: { version: 1, nodes: [], edges: [], groups: [] },
      },
    });
    res.status(201).json({ canvas });
  });

  router.get('/:id', async (req: Request, res: Response) => {
    const canvas = await prisma.builderCanvas.findFirst({
      where: { id: String(req.params.id), orgId: req.auth!.orgId },
    });
    if (!canvas) {
      res.status(404).json({ error: { code: 'not_found', message: 'Canvas not found' } });
      return;
    }
    res.json({ canvas });
  });

  router.patch('/:id', async (req: Request, res: Response) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? 'name or graph is required');
      return;
    }
    const auth = req.auth!;
    const existing = await prisma.builderCanvas.findFirst({
      where: { id: String(req.params.id), orgId: auth.orgId },
      select: { id: true, createdByUserId: true },
    });
    if (!existing) {
      res.status(404).json({ error: { code: 'not_found', message: 'Canvas not found' } });
      return;
    }
    if (!canManage(existing.createdByUserId, auth.userId, auth.role)) {
      res.status(403).json({
        error: { code: 'forbidden', message: 'Only the creator, an admin, or an owner can edit this canvas' },
      });
      return;
    }

    const canvas = await prisma.builderCanvas.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name != null ? { name: parsed.data.name } : {}),
        // Zod validated the shape; Prisma's InputJsonValue can't express `unknown` members,
        // so the cast is the handoff between the two type systems.
        ...(parsed.data.graph != null
          ? { graph: parsed.data.graph as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    res.json({ canvas });
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    const auth = req.auth!;
    const existing = await prisma.builderCanvas.findFirst({
      where: { id: String(req.params.id), orgId: auth.orgId },
      select: { id: true, createdByUserId: true },
    });
    if (!existing) {
      res.status(404).json({ error: { code: 'not_found', message: 'Canvas not found' } });
      return;
    }
    if (!canManage(existing.createdByUserId, auth.userId, auth.role)) {
      res.status(403).json({
        error: { code: 'forbidden', message: 'Only the creator, an admin, or an owner can delete this canvas' },
      });
      return;
    }
    await prisma.builderCanvas.delete({ where: { id: existing.id } });
    res.status(204).end();
  });

  return router;
}
