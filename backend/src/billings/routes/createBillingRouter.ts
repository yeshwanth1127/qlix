import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { authenticateUser } from '../../middleware/authenticateUser.js';
import { requireOrgAction } from '../middleware/requireOrgAction.js';
import { billingCycleFromDateUtc } from '../lib/billingCycle.js';
import { canonicalBillingServiceKey } from '../lib/billingServiceCatalog.js';
import { ensureBillingDefaults } from '../lib/ensureDefaults.js';
import { sessionOrganizationPayload } from '../lib/subscriptionAccess.js';

const eventsQuerySchema = z.object({
  billingCycle: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  eventType: z.string().min(1).max(120).optional(),
  take: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().uuid().optional(),
});

export function createBillingRouter(): Router {
  const router = Router();

  /** Live USD→INR rate for dual-currency display. */
  router.get('/fx', authenticateUser(true), async (_request: Request, response: Response) => {
    try {
      const { getUsdInrRate } = await import('../../llm/fxRate.js');
      const fx = await getUsdInrRate();
      response.json({
        base: 'USD',
        quote: 'INR',
        rate: fx.rate,
        asOf: fx.asOf,
        source: fx.source,
      });
    } catch (error) {
      console.error('[billing/fx]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load FX rate' } });
    }
  });

  /** Public catalog of subscription plans with futuristic display names + INR prices. */
  router.get('/plans', authenticateUser(true), async (_request: Request, response: Response) => {
    try {
      await ensureBillingDefaults(prisma);
      const { PLAN_CONFIG } = await import('../lib/subscriptionPlans.js');
      const { planDisplayName, planBlurb } = await import('../lib/planDisplay.js');
      const { getUsdInrRate } = await import('../../llm/fxRate.js');
      const fx = await getUsdInrRate();

      const slugs = ['starter', 'growth', 'business'] as const;
      const plans = slugs.map((slug) => {
        const cfg = PLAN_CONFIG[slug]!;
        const monthlyInr = Number(cfg.monthlyPriceInr.toString());
        return {
          id: slug,
          displayName: planDisplayName(slug),
          blurb: planBlurb(slug),
          monthlyPriceInr: cfg.monthlyPriceInr.toString(),
          monthlyPriceUsd: (monthlyInr / fx.rate).toFixed(2),
          maxAgents: cfg.maxAgents,
          freeMonthlyCreditInr: cfg.freeMonthlyCredit.toString(),
          allowedModelTiers: cfg.allowedModelTiers,
          whatsappMsgLimit: cfg.whatsappMsgLimit,
        };
      });

      response.json({
        plans,
        fx: { base: 'USD', quote: 'INR', rate: fx.rate, asOf: fx.asOf, source: fx.source },
      });
    } catch (error) {
      console.error('[billing/plans]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load plans' } });
    }
  });

  /** Any signed-in member can read subscription/trial status (used by Subscriptions page + gates). */
  router.get('/subscription', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const org = await prisma.organization.findUnique({
        where: { id: auth.orgId },
        select: { id: true, name: true, slug: true, workspaceKind: true, plan: true },
      });
      if (!org) {
        response.status(404).json({ error: { code: 'not_found', message: 'Organization not found' } });
        return;
      }
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { isSuperAdmin: true },
      });
      const payload = await sessionOrganizationPayload(org, {
        email: auth.email,
        isSuperAdmin: Boolean(user?.isSuperAdmin),
      });
      response.json({ subscription: payload.subscription, plan: payload.plan });
    } catch (error) {
      console.error('[billing/subscription]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load subscription' } });
    }
  });

  router.get('/overview', authenticateUser(true), requireOrgAction('billing'), async (request: Request, response: Response) => {
    try {
      await ensureBillingDefaults(prisma);
      const auth = request.auth!;
      const orgId = auth.orgId;

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { id: true, name: true, plan: true },
      });
      if (!org) {
        response.status(404).json({ error: { code: 'not_found', message: 'Organization not found' } });
        return;
      }

      const cycle = billingCycleFromDateUtc(new Date());

      const wallet = await prisma.wallet.findUnique({
        where: { orgId },
        select: { balance: true, freeBalance: true, paidBalance: true, freeExpiresAt: true, currency: true },
      });

      const subscription = await prisma.orgSubscription.findUnique({
        where: { orgId },
        select: { planName: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
      });

      const [successCount, spend] = await Promise.all([
        prisma.successfulEvent.count({ where: { orgId, billingCycle: cycle } }),
        prisma.successfulEvent.aggregate({
          where: { orgId, billingCycle: cycle },
          _sum: { amountCharged: true },
        }),
      ]);

      const monthStart = new Date(Date.UTC(Number(cycle.slice(0, 4)), Number(cycle.slice(5, 7)) - 1, 1));
      const failCount = await prisma.failedEvent.count({ where: { orgId, occurredAt: { gte: monthStart } } });

      const byType = await prisma.successfulEvent.groupBy({
        by: ['eventType'],
        where: { orgId, billingCycle: cycle },
        _count: { id: true },
        _sum: { amountCharged: true },
        orderBy: { _count: { id: 'desc' } },
      });

      const billingServices = await prisma.billingService.findMany({
        orderBy: [{ sortOrder: 'asc' }, { serviceKey: 'asc' }],
      });

      const usageByCanonical = new Map<string, { count: number; spend: Prisma.Decimal }>();
      for (const row of byType) {
        const key = canonicalBillingServiceKey(row.eventType);
        const rowSpend = row._sum.amountCharged ?? new Prisma.Decimal('0');
        const prev = usageByCanonical.get(key) ?? { count: 0, spend: new Prisma.Decimal('0') };
        prev.count += row._count.id;
        prev.spend = prev.spend.add(rowSpend);
        usageByCanonical.set(key, prev);
      }

      const definedKeys = new Set(billingServices.map((s) => s.serviceKey));
      const servicesPayload = billingServices.map((s) => {
        const u = usageByCanonical.get(s.serviceKey);
        return {
          serviceKey: s.serviceKey,
          displayName: s.displayName,
          unitPrice: s.unitPrice.toString(),
          mtdSuccesses: u?.count ?? 0,
          mtdSpend: (u?.spend ?? new Prisma.Decimal('0')).toString(),
        };
      });

      const unlistedServices: Array<{
        serviceKey: string;
        displayName: string;
        unitPrice: string;
        mtdSuccesses: number;
        mtdSpend: string;
      }> = [];
      for (const [key, u] of usageByCanonical) {
        if (definedKeys.has(key)) continue;
        unlistedServices.push({
          serviceKey: key,
          displayName: key,
          unitPrice: '0',
          mtdSuccesses: u.count,
          mtdSpend: u.spend.toString(),
        });
      }
      unlistedServices.sort((a, b) => a.serviceKey.localeCompare(b.serviceKey));

      response.json({
        organization: { id: org.id, name: org.name, plan: org.plan },
        billingCycle: cycle,
        wallet: wallet
          ? {
              balance: wallet.balance.toString(),
              freeBalance: wallet.freeBalance.toString(),
              paidBalance: wallet.paidBalance.toString(),
              freeExpiresAt: wallet.freeExpiresAt ? wallet.freeExpiresAt.toISOString() : null,
              currency: wallet.currency,
            }
          : { balance: '0', freeBalance: '0', paidBalance: '0', freeExpiresAt: null, currency: 'INR' },
        subscription: subscription
          ? {
              planName: subscription.planName,
              status: subscription.status,
              currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
              cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            }
          : null,
        plan: { name: org.plan },
        services: servicesPayload,
        ...(unlistedServices.length > 0 ? { unlistedServices } : {}),
        monthToDate: {
          successfulEvents: successCount,
          failedEvents: failCount,
          spend: (spend._sum.amountCharged ?? new Prisma.Decimal('0')).toString(),
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() } });
        return;
      }
      console.error('[billing/overview]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load billing overview' } });
    }
  });

  router.get('/events', authenticateUser(true), requireOrgAction('billing'), async (request: Request, response: Response) => {
    try {
      await ensureBillingDefaults(prisma);
      const auth = request.auth!;
      const orgId = auth.orgId;
      const query = eventsQuerySchema.parse(request.query);

      const cycle = query.billingCycle ?? billingCycleFromDateUtc(new Date());

      const rows = await prisma.successfulEvent.findMany({
        where: {
          orgId,
          billingCycle: cycle,
          ...(query.eventType ? { eventType: query.eventType } : null),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: query.take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : null),
        select: {
          id: true,
          eventType: true,
          amountCharged: true,
          occurredAt: true,
          userId: true,
          agentId: true,
          apiEndpoint: true,
          httpStatusCode: true,
          responseTimeMs: true,
        },
      });

      const hasMore = rows.length > query.take;
      const slice = hasMore ? rows.slice(0, query.take) : rows;
      const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;

      response.json({
        billingCycle: cycle,
        nextCursor,
        events: slice.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          amountCharged: e.amountCharged.toString(),
          occurredAt: e.occurredAt.toISOString(),
          userId: e.userId,
          agentId: e.agentId,
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
      console.error('[billing/events]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to list events' } });
    }
  });

  router.get('/statements', authenticateUser(true), requireOrgAction('billing'), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const orgId = auth.orgId;

      const rows = await prisma.billingStatement.findMany({
        where: { orgId },
        orderBy: [{ billingCycle: 'desc' }],
        take: 36,
        select: { id: true, billingCycle: true, status: true, finalizedAt: true, total: true, createdAt: true },
      });

      response.json({
        statements: rows.map((s) => ({
          id: s.id,
          billingCycle: s.billingCycle,
          status: s.status,
          finalizedAt: s.finalizedAt ? s.finalizedAt.toISOString() : null,
          total: s.total.toString(),
          createdAt: s.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      console.error('[billing/statements]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to list statements' } });
    }
  });

  router.get('/statements/:billingCycle', authenticateUser(true), requireOrgAction('billing'), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const orgId = auth.orgId;
      const cycle = request.params.billingCycle;
      if (!cycle || !/^\d{4}-\d{2}$/.test(cycle)) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Invalid billing cycle' } });
        return;
      }

      const statement = await prisma.billingStatement.findUnique({
        where: { orgId_billingCycle: { orgId, billingCycle: cycle } },
        include: { lineItems: { orderBy: [{ amount: 'desc' }] } },
      });
      if (!statement) {
        response.status(404).json({ error: { code: 'not_found', message: 'Statement not found' } });
        return;
      }

      response.json({
        statement: {
          id: statement.id,
          billingCycle: statement.billingCycle,
          status: statement.status,
          finalizedAt: statement.finalizedAt ? statement.finalizedAt.toISOString() : null,
          subtotal: statement.subtotal.toString(),
          total: statement.total.toString(),
          createdAt: statement.createdAt.toISOString(),
          updatedAt: statement.updatedAt.toISOString(),
        },
        lineItems: statement.lineItems.map((li) => ({
          id: li.id,
          eventType: li.eventType,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice.toString(),
          amount: li.amount.toString(),
        })),
      });
    } catch (error) {
      console.error('[billing/statements/:billingCycle]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load statement' } });
    }
  });

  return router;
}

