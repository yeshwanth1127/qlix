import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const homepageVisitSchema = z
  .object({
    visitorId: z.string().uuid(),
  })
  .strict();

/**
 * Records one homepage visit per browser-generated visitor ID. Only a SHA-256
 * hash is persisted; no IP address, user agent, or raw identifier is stored.
 */
export function createHomepageVisitsRouter(): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: {
        code: 'rate_limited',
        message: 'Too many visit events.',
      },
    },
  });

  router.post('/', limiter, async (request: Request, response: Response) => {
    const parsed = homepageVisitSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: 'invalid_visitor_id',
          message: 'A valid visitor ID is required.',
        },
      });
      return;
    }

    const visitorTokenHash = createHash('sha256').update(parsed.data.visitorId).digest('hex');

    try {
      await prisma.homepageVisit.upsert({
        where: { visitorTokenHash },
        update: {},
        create: { visitorTokenHash },
      });
      response.status(204).send();
    } catch (error) {
      console.error('[homepage-visits] failed to record visit', error);
      response.status(500).json({
        error: {
          code: 'visit_tracking_failed',
          message: 'Could not record homepage visit.',
        },
      });
    }
  });

  return router;
}
