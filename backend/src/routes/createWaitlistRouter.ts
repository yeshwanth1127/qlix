import { Prisma } from '@prisma/client';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const waitlistInputSchema = z.discriminatedUnion('contactType', [
  z
    .object({
      contactType: z.literal('email'),
      contact: z.string().trim().email().max(320),
    })
    .strict(),
  z
    .object({
      contactType: z.literal('phone'),
      contact: z.string().trim().max(32),
    })
    .strict(),
]);

const phonePattern = /^\+[1-9]\d{7,14}$/;

/**
 * Public beta waitlist intake. Duplicate contacts intentionally receive the
 * same response as new entries so this endpoint cannot be used for enumeration.
 */
export function createWaitlistRouter(): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: {
        code: 'rate_limited',
        message: 'Too many attempts. Please try again in a few minutes.',
      },
    },
  });

  router.post('/', limiter, async (request: Request, response: Response) => {
    const parsed = waitlistInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: 'invalid_contact',
          message: 'Enter one valid email address or phone number.',
        },
      });
      return;
    }

    const { contactType } = parsed.data;
    const normalized =
      contactType === 'email'
        ? parsed.data.contact.toLowerCase()
        : parsed.data.contact.replace(/[\s().-]/g, '');

    if (contactType === 'phone' && !phonePattern.test(normalized)) {
      response.status(400).json({
        error: {
          code: 'invalid_phone',
          message: 'Enter a phone number with country code, such as +1 555 123 4567.',
        },
      });
      return;
    }

    try {
      await prisma.waitlistEntry.create({
        data: contactType === 'email' ? { email: normalized } : { phone: normalized },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        console.error('waitlist signup failed', error);
        response.status(500).json({
          error: {
            code: 'waitlist_failed',
            message: 'Could not join the waitlist right now. Please try again.',
          },
        });
        return;
      }
    }

    response.status(200).json({ ok: true });
  });

  return router;
}
