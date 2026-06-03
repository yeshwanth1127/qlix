import { Router } from 'express';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticateUser } from '../../middleware/authenticateUser.js';
import { billingCycleFromDateUtc, parseOccurredAt } from '../lib/billingCycle.js';
import { ensureBillingDefaults } from '../lib/ensureDefaults.js';
import { getServiceTokenFromRequest, verifyServiceToken } from '../lib/serviceToken.js';
import { lookupBillingUnitPrice } from '../lib/priceLookup.js';

function isPrismaUniqueConstraintError(error: unknown): error is { code: string } {
  if (!error || typeof error !== 'object') return false;
  const anyErr = error as Record<string, unknown>;
  return anyErr.code === 'P2002';
}

const successSchema = z.object({
  eventKey: z.string().min(8).max(256),
  eventType: z.string().min(2).max(120),
  occurredAt: z.string().datetime().optional(),
  orgId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  agentId: z.string().min(8).max(128).optional(),
  eventData: z.unknown().optional(),
  apiEndpoint: z.string().min(1).max(255).optional(),
  httpStatusCode: z.number().int().optional(),
  responseTimeMs: z.number().int().nonnegative().optional(),
});

const failureSchema = z.object({
  eventKey: z.string().min(8).max(256),
  eventType: z.string().min(2).max(120),
  occurredAt: z.string().datetime().optional(),
  orgId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  agentId: z.string().min(8).max(128).optional(),
  apiEndpoint: z.string().min(1).max(255).optional(),
  httpStatusCode: z.number().int().optional(),
  requestData: z.unknown().optional(),
  errorMessage: z.string().max(10_000).optional(),
  errorCode: z.string().max(120).optional(),
});

function requireAuthOrServiceToken(request: Request, response: Response): { ok: true } | { ok: false } {
  if (request.auth) return { ok: true };
  const token = getServiceTokenFromRequest(request);
  if (token && verifyServiceToken(token)) return { ok: true };
  response.status(401).json({ error: { code: 'unauthorized', message: 'Missing auth or service token' } });
  return { ok: false };
}

function deriveOrgAndUser(request: Request, body: { orgId?: string; userId?: string }): { orgId: string; userId: string } | null {
  if (request.auth) return { orgId: request.auth.orgId, userId: request.auth.userId };
  if (body.orgId && body.userId) return { orgId: body.orgId, userId: body.userId };
  return null;
}

export function createBillingIngestRouter(): Router {
  const router = Router();

  // Optional cookie auth; callers may be services.
  router.use(authenticateUser(false));

  router.post('/success', async (request: Request, response: Response) => {
    try {
      const gate = requireAuthOrServiceToken(request, response);
      if (!gate.ok) return;

      await ensureBillingDefaults(prisma);
      const body = successSchema.parse(request.body);
      const derived = deriveOrgAndUser(request, body);
      if (!derived) {
        response.status(400).json({ error: { code: 'validation_error', message: 'orgId and userId are required for service calls' } });
        return;
      }

      const occurredAt = parseOccurredAt(body.occurredAt) ?? new Date();
      const billingCycle = billingCycleFromDateUtc(occurredAt);

      const price = await lookupBillingUnitPrice({
        prisma,
        eventType: body.eventType,
      });
      const amountCharged = price.unitPrice;

      const result = await prisma.$transaction(async (tx) => {
        const event = await tx.successfulEvent.create({
          data: {
            orgId: derived.orgId,
            userId: derived.userId,
            agentId: body.agentId ?? null,
            eventType: body.eventType,
            amountCharged,
            billingCycle,
            successfulEventKey: body.eventKey,
            eventData: body.eventData as any,
            apiEndpoint: body.apiEndpoint ?? null,
            httpStatusCode: body.httpStatusCode ?? null,
            responseTimeMs: body.responseTimeMs ?? null,
            occurredAt,
          },
        });

        let walletAfter: Prisma.Decimal | null = null;
        if (amountCharged.gt(0)) {
          const wallet = await tx.wallet.findUnique({ where: { orgId: derived.orgId } });
          const orgWallet =
            wallet ??
            (await tx.wallet.create({
              data: { orgId: derived.orgId, currency: 'USD', balance: 0 },
            }));

          const updated = await tx.wallet.update({
            where: { id: orgWallet.id },
            data: { balance: { decrement: amountCharged } },
            select: { balance: true },
          });
          walletAfter = updated.balance;

          await tx.transaction.create({
            data: {
              walletId: orgWallet.id,
              successfulEventId: event.id,
              type: 'usage_debit',
              amount: amountCharged.neg(),
              status: 'posted',
            },
          });
        }

        await tx.billingLog.create({
          data: {
            orgId: derived.orgId,
            action: 'event_recorded',
            status: 'success',
            details: {
              eventId: event.id,
              eventType: body.eventType,
              billedServiceKey: price.serviceKey,
              billingCycle,
              amountCharged: amountCharged.toString(),
              walletAfter: walletAfter ? walletAfter.toString() : null,
            },
          },
        });

        return { event, walletAfter };
      });

      response.status(201).json({
        ok: true,
        event: {
          id: result.event.id,
          orgId: result.event.orgId,
          userId: result.event.userId,
          agentId: result.event.agentId,
          eventType: result.event.eventType,
          amountCharged: result.event.amountCharged.toString(),
          billingCycle: result.event.billingCycle,
          occurredAt: result.event.occurredAt.toISOString(),
        },
        walletAfter: result.walletAfter ? result.walletAfter.toString() : null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() } });
        return;
      }
      if (isPrismaUniqueConstraintError(error)) {
        // Idempotent replay: return existing event.
        try {
          const body = successSchema.parse(request.body);
          const derived = deriveOrgAndUser(request, body);
          if (!derived) {
            response.status(409).json({ error: { code: 'conflict', message: 'Duplicate event' } });
            return;
          }
          const existing = await prisma.successfulEvent.findUnique({
            where: { orgId_successfulEventKey: { orgId: derived.orgId, successfulEventKey: body.eventKey } },
          });
          if (!existing) {
            response.status(409).json({ error: { code: 'conflict', message: 'Duplicate event' } });
            return;
          }
          response.status(200).json({
            ok: true,
            idempotentReplay: true,
            event: {
              id: existing.id,
              orgId: existing.orgId,
              userId: existing.userId,
              agentId: existing.agentId,
              eventType: existing.eventType,
              amountCharged: existing.amountCharged.toString(),
              billingCycle: existing.billingCycle,
              occurredAt: existing.occurredAt.toISOString(),
            },
          });
          return;
        } catch {
          response.status(409).json({ error: { code: 'conflict', message: 'Duplicate event' } });
          return;
        }
      }
      console.error('[billing/ingest/success]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to record event' } });
    }
  });

  router.post('/failure', async (request: Request, response: Response) => {
    try {
      const gate = requireAuthOrServiceToken(request, response);
      if (!gate.ok) return;

      await ensureBillingDefaults(prisma);
      const body = failureSchema.parse(request.body);
      const derived = deriveOrgAndUser(request, body);
      if (!derived) {
        response.status(400).json({ error: { code: 'validation_error', message: 'orgId and userId are required for service calls' } });
        return;
      }

      const occurredAt = parseOccurredAt(body.occurredAt) ?? new Date();
      const billingCycle = billingCycleFromDateUtc(occurredAt);

      const failed = await prisma.failedEvent.create({
        data: {
          orgId: derived.orgId,
          userId: derived.userId,
          agentId: body.agentId ?? null,
          eventType: body.eventType,
          errorMessage: body.errorMessage ?? null,
          errorCode: body.errorCode ?? null,
          requestData: body.requestData as any,
          apiEndpoint: body.apiEndpoint ?? null,
          httpStatusCode: body.httpStatusCode ?? null,
          occurredAt,
        },
      });

      await prisma.billingLog.create({
        data: {
          orgId: derived.orgId,
          action: 'failure_recorded',
          status: 'success',
          details: {
            failedEventId: failed.id,
            eventType: body.eventType,
            billingCycle,
          },
        },
      });

      response.status(201).json({
        ok: true,
        failedEvent: {
          id: failed.id,
          orgId: failed.orgId,
          userId: failed.userId,
          agentId: failed.agentId,
          eventType: failed.eventType,
          occurredAt: failed.occurredAt.toISOString(),
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() } });
        return;
      }
      console.error('[billing/ingest/failure]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to record failure' } });
    }
  });

  return router;
}

