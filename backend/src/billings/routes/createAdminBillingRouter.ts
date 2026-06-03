import { Router } from 'express';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticateUser } from '../../middleware/authenticateUser.js';
import { requireSuperAdmin } from '../middleware/requireSuperAdmin.js';
import { billingCycleFromDateUtc } from '../lib/billingCycle.js';
import { ensureBillingDefaults } from '../lib/ensureDefaults.js';
import { runBillingRollups } from '../jobs/billingRollups.js';

const listEventsQuerySchema = z.object({
  billingCycle: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  orgId: z.string().uuid().optional(),
  eventType: z.string().min(1).max(120).optional(),
  take: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().uuid().optional(),
});

const listOrgsQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().uuid().optional(),
});

const patchPlanSchema = z.object({
  plan: z.string().min(1).max(50),
});

const creditSchema = z.object({
  amount: z.string().min(1).max(64),
  reason: z.string().min(1).max(255).optional(),
});

const setRateSchema = z.object({
  eventType: z.string().min(1).max(120),
  unitPrice: z.string().min(1).max(64),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
});

const triggerRollupSchema = z.object({
  mode: z.enum(['daily', 'monthly', 'both']).default('both'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  billingCycle: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const patchBillingServiceSchema = z.object({
  unitPrice: z.string().min(1).max(64),
  displayName: z.string().min(1).max(200).optional(),
});

export function createAdminBillingRouter(): Router {
  const router = Router();
  router.use(authenticateUser(true));
  router.use(requireSuperAdmin);

  router.get('/metrics', async (_request: Request, response: Response) => {
    try {
      await ensureBillingDefaults(prisma);
      const cycle = billingCycleFromDateUtc(new Date());

      const [successCount, revenue, failureCount] = await Promise.all([
        prisma.successfulEvent.count({ where: { billingCycle: cycle } }),
        prisma.successfulEvent.aggregate({ where: { billingCycle: cycle }, _sum: { amountCharged: true } }),
        prisma.failedEvent.count({
          where: {
            occurredAt: {
              gte: new Date(Date.UTC(Number(cycle.slice(0, 4)), Number(cycle.slice(5, 7)) - 1, 1)),
            },
          },
        }),
      ]);

      const revenueTotal = revenue._sum.amountCharged ?? new Prisma.Decimal('0');
      const avg = successCount > 0 ? revenueTotal.div(successCount) : new Prisma.Decimal('0');

      response.json({
        billingCycle: cycle,
        successesThisMonth: successCount,
        revenueThisMonth: revenueTotal.toString(),
        avgPerSuccess: avg.toString(),
        failedAttemptsThisMonth: failureCount,
      });
    } catch (error) {
      console.error('[admin/billing/metrics]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load metrics' } });
    }
  });

  router.get('/events', async (request: Request, response: Response) => {
    try {
      await ensureBillingDefaults(prisma);
      const query = listEventsQuerySchema.parse(request.query);
      const cycle = query.billingCycle ?? billingCycleFromDateUtc(new Date());

      const rows = await prisma.successfulEvent.findMany({
        where: {
          billingCycle: cycle,
          ...(query.orgId ? { orgId: query.orgId } : null),
          ...(query.eventType ? { eventType: query.eventType } : null),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: query.take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : null),
        include: { organization: { select: { id: true, name: true } } },
      });

      const hasMore = rows.length > query.take;
      const slice = hasMore ? rows.slice(0, query.take) : rows;
      const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;

      response.json({
        billingCycle: cycle,
        nextCursor,
        events: slice.map((e) => ({
          id: e.id,
          occurredAt: e.occurredAt.toISOString(),
          org: { id: e.organization.id, name: e.organization.name },
          userId: e.userId,
          agentId: e.agentId,
          eventType: e.eventType,
          amountCharged: e.amountCharged.toString(),
          apiEndpoint: e.apiEndpoint,
          httpStatusCode: e.httpStatusCode,
          responseTimeMs: e.responseTimeMs,
        })),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid query', details: error.flatten() } });
        return;
      }
      console.error('[admin/billing/events]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to list events' } });
    }
  });

  router.get('/orgs', async (request: Request, response: Response) => {
    try {
      await ensureBillingDefaults(prisma);
      const query = listOrgsQuerySchema.parse(request.query);
      const cycle = billingCycleFromDateUtc(new Date());

      const orgs = await prisma.organization.findMany({
        where: { workspaceKind: 'organization' },
        orderBy: [{ createdAt: 'desc' }],
        take: query.take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : null),
        select: { id: true, name: true, plan: true, slug: true, createdAt: true },
      });

      const hasMore = orgs.length > query.take;
      const slice = hasMore ? orgs.slice(0, query.take) : orgs;
      const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;

      const wallets = await prisma.wallet.findMany({
        where: { orgId: { in: slice.map((o) => o.id) } },
        select: { orgId: true, balance: true, currency: true },
      });
      const walletByOrg = new Map(wallets.map((w) => [w.orgId!, w]));

      const spend = await prisma.successfulEvent.groupBy({
        by: ['orgId'],
        where: { orgId: { in: slice.map((o) => o.id) }, billingCycle: cycle },
        _sum: { amountCharged: true },
        _count: { id: true },
      });
      const spendByOrg = new Map(spend.map((s) => [s.orgId, s]));

      response.json({
        billingCycle: cycle,
        nextCursor,
        organizations: slice.map((o) => {
          const w = walletByOrg.get(o.id);
          const s = spendByOrg.get(o.id);
          const revenue = s?._sum.amountCharged ?? new Prisma.Decimal('0');
          return {
            id: o.id,
            name: o.name,
            slug: o.slug,
            plan: o.plan,
            wallet: w ? { balance: w.balance.toString(), currency: w.currency } : { balance: '0', currency: 'USD' },
            monthToDate: {
              successes: s?._count.id ?? 0,
              spend: revenue.toString(),
            },
            createdAt: o.createdAt.toISOString(),
          };
        }),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid query', details: error.flatten() } });
        return;
      }
      console.error('[admin/billing/orgs]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to list organizations' } });
    }
  });

  router.post('/orgs/:orgId/plan', async (request: Request, response: Response) => {
    try {
      const orgId = request.params.orgId;
      if (!orgId) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Missing orgId' } });
        return;
      }
      const body = patchPlanSchema.parse(request.body);
      const updated = await prisma.organization.update({
        where: { id: orgId },
        data: { plan: body.plan },
        select: { id: true, plan: true },
      });
      response.json({ organization: updated });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() } });
        return;
      }
      console.error('[admin/billing/orgs/:orgId/plan]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to update plan' } });
    }
  });

  router.post('/orgs/:orgId/credit', async (request: Request, response: Response) => {
    try {
      const orgId = request.params.orgId;
      if (!orgId) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Missing orgId' } });
        return;
      }
      const body = creditSchema.parse(request.body);
      const amount = new Prisma.Decimal(body.amount);
      if (amount.lte(0)) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Amount must be > 0' } });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { orgId } });
        const orgWallet =
          wallet ??
          (await tx.wallet.create({
            data: { orgId, currency: 'USD', balance: 0 },
          }));
        const updated = await tx.wallet.update({
          where: { id: orgWallet.id },
          data: { balance: { increment: amount } },
          select: { balance: true, currency: true },
        });
        await tx.transaction.create({
          data: {
            walletId: orgWallet.id,
            type: 'manual_credit',
            amount,
            status: 'posted',
          },
        });
        await tx.billingLog.create({
          data: {
            orgId,
            action: 'manual_credit',
            status: 'success',
            details: { amount: amount.toString(), reason: body.reason ?? null },
          },
        });
        return updated;
      });

      response.status(201).json({ wallet: { balance: result.balance.toString(), currency: result.currency } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() } });
        return;
      }
      console.error('[admin/billing/orgs/:orgId/credit]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to apply credit' } });
    }
  });

  router.post('/orgs/:orgId/rates', async (request: Request, response: Response) => {
    try {
      const orgId = request.params.orgId;
      if (!orgId) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Missing orgId' } });
        return;
      }
      const body = setRateSchema.parse(request.body);
      const unitPrice = new Prisma.Decimal(body.unitPrice);
      const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
      const effectiveTo = body.effectiveTo ? new Date(body.effectiveTo) : null;

      const created = await prisma.orgRateOverride.create({
        data: {
          orgId,
          eventType: body.eventType,
          unitPrice,
          effectiveFrom,
          effectiveTo,
        },
        select: { id: true, eventType: true, unitPrice: true, effectiveFrom: true, effectiveTo: true },
      });

      await prisma.billingLog.create({
        data: {
          orgId,
          action: 'rate_override_set',
          status: 'success',
          details: {
            overrideId: created.id,
            eventType: created.eventType,
            unitPrice: created.unitPrice.toString(),
            effectiveFrom: created.effectiveFrom.toISOString(),
            effectiveTo: created.effectiveTo ? created.effectiveTo.toISOString() : null,
          },
        },
      });

      response.status(201).json({
        override: {
          id: created.id,
          eventType: created.eventType,
          unitPrice: created.unitPrice.toString(),
          effectiveFrom: created.effectiveFrom.toISOString(),
          effectiveTo: created.effectiveTo ? created.effectiveTo.toISOString() : null,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() } });
        return;
      }
      console.error('[admin/billing/orgs/:orgId/rates]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to set rate override' } });
    }
  });

  router.post('/trigger-rollup', async (request: Request, response: Response) => {
    try {
      const body = triggerRollupSchema.parse(request.body ?? {});
      const date = body.date ? new Date(`${body.date}T00:00:00.000Z`) : undefined;
      const res = await runBillingRollups({
        prisma,
        mode: body.mode,
        targetDateUtc: date,
        billingCycle: body.billingCycle,
      });

      response.status(200).json(res);
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() } });
        return;
      }
      console.error('[admin/billing/trigger-rollup]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to run rollups' } });
    }
  });

  router.get('/services', async (_request: Request, response: Response) => {
    try {
      await ensureBillingDefaults(prisma);
      const rows = await prisma.billingService.findMany({
        orderBy: [{ sortOrder: 'asc' }, { serviceKey: 'asc' }],
      });
      response.json({
        services: rows.map((s) => ({
          serviceKey: s.serviceKey,
          displayName: s.displayName,
          unitPrice: s.unitPrice.toString(),
          sortOrder: s.sortOrder,
        })),
      });
    } catch (error) {
      console.error('[admin/billing/services]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to list billing services' } });
    }
  });

  router.patch('/services/:serviceKey', async (request: Request, response: Response) => {
    try {
      await ensureBillingDefaults(prisma);
      const serviceKey = request.params.serviceKey?.trim();
      if (!serviceKey) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Missing serviceKey' } });
        return;
      }
      const body = patchBillingServiceSchema.parse(request.body);
      const unitPrice = new Prisma.Decimal(body.unitPrice);

      const existing = await prisma.billingService.findUnique({ where: { serviceKey } });
      if (!existing) {
        response.status(404).json({ error: { code: 'not_found', message: 'Unknown billing service' } });
        return;
      }

      const updated = await prisma.billingService.update({
        where: { serviceKey },
        data: {
          unitPrice,
          ...(body.displayName !== undefined ? { displayName: body.displayName.trim() } : {}),
        },
      });

      response.json({
        service: {
          serviceKey: updated.serviceKey,
          displayName: updated.displayName,
          unitPrice: updated.unitPrice.toString(),
          sortOrder: updated.sortOrder,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() } });
        return;
      }
      console.error('[admin/billing/services/:serviceKey]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to update billing service' } });
    }
  });

  return router;
}

