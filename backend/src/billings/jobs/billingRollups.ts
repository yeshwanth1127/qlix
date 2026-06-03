import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { ensureBillingDefaults } from '../lib/ensureDefaults.js';

export type RollupMode = 'daily' | 'monthly' | 'both';

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400_000);
}

function monthStartUtcFromBillingCycle(cycle: string): Date | null {
  const m = cycle.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}

function nextMonthStartUtc(start: Date): Date {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

export async function runBillingRollups(params: {
  prisma: PrismaClient;
  mode: RollupMode;
  targetDateUtc?: Date;
  billingCycle?: string;
}): Promise<{ ok: true; daily?: { date: string; rows: number }; monthly?: { billingCycle: string; statements: number } }> {
  const { prisma, mode } = params;
  await ensureBillingDefaults(prisma);

  const result: { ok: true; daily?: { date: string; rows: number }; monthly?: { billingCycle: string; statements: number } } = { ok: true };

  if (mode === 'daily' || mode === 'both') {
    const base = params.targetDateUtc ? startOfUtcDay(params.targetDateUtc) : startOfUtcDay(addUtcDays(new Date(), -1));
    const next = addUtcDays(base, 1);

    const [successAgg, failureAgg] = await Promise.all([
      prisma.successfulEvent.groupBy({
        by: ['orgId', 'eventType'],
        where: { occurredAt: { gte: base, lt: next } },
        _count: { id: true },
        _sum: { amountCharged: true },
      }),
      prisma.failedEvent.groupBy({
        by: ['orgId', 'eventType'],
        where: { occurredAt: { gte: base, lt: next } },
        _count: { id: true },
      }),
    ]);

    const key = (orgId: string, eventType: string) => `${orgId}::${eventType}`;
    const failedByKey = new Map(failureAgg.map((r) => [key(r.orgId, r.eventType), r._count.id]));

    let upserts = 0;
    for (const row of successAgg) {
      const failedCount = failedByKey.get(key(row.orgId, row.eventType)) ?? 0;
      const revenue = row._sum.amountCharged ?? new Prisma.Decimal('0');
      await prisma.usageMetricDaily.upsert({
        where: {
          orgId_metricDate_eventType: {
            orgId: row.orgId,
            metricDate: base,
            eventType: row.eventType,
          },
        },
        update: {
          successfulCount: row._count.id,
          failedCount,
          revenueGenerated: revenue,
        },
        create: {
          orgId: row.orgId,
          metricDate: base,
          eventType: row.eventType,
          successfulCount: row._count.id,
          failedCount,
          revenueGenerated: revenue,
        },
      });
      upserts += 1;
    }

    // Handle pure-failure keys (no successes) so failed charts stay accurate.
    for (const row of failureAgg) {
      const k = key(row.orgId, row.eventType);
      const hasSuccess = successAgg.some((s) => key(s.orgId, s.eventType) === k);
      if (hasSuccess) continue;
      await prisma.usageMetricDaily.upsert({
        where: {
          orgId_metricDate_eventType: {
            orgId: row.orgId,
            metricDate: base,
            eventType: row.eventType,
          },
        },
        update: {
          successfulCount: 0,
          failedCount: row._count.id,
          revenueGenerated: new Prisma.Decimal('0'),
        },
        create: {
          orgId: row.orgId,
          metricDate: base,
          eventType: row.eventType,
          successfulCount: 0,
          failedCount: row._count.id,
          revenueGenerated: new Prisma.Decimal('0'),
        },
      });
      upserts += 1;
    }

    result.daily = { date: base.toISOString().slice(0, 10), rows: upserts };
  }

  if (mode === 'monthly' || mode === 'both') {
    const cycle = params.billingCycle ?? new Date().toISOString().slice(0, 7);
    const start = monthStartUtcFromBillingCycle(cycle);
    if (!start) {
      throw new Error('Invalid billing cycle format, expected YYYY-MM');
    }
    const end = nextMonthStartUtc(start);

    const orgs = await prisma.organization.findMany({
      where: { workspaceKind: 'organization' },
      select: { id: true },
    });

    let statements = 0;
    for (const org of orgs) {
      const sums = await prisma.successfulEvent.groupBy({
        by: ['eventType'],
        where: { orgId: org.id, occurredAt: { gte: start, lt: end } },
        _count: { id: true },
        _sum: { amountCharged: true },
      });

      const subtotal = sums.reduce((acc, r) => acc.add(r._sum.amountCharged ?? new Prisma.Decimal('0')), new Prisma.Decimal('0'));

      await prisma.$transaction(async (tx) => {
        const existing = await tx.billingStatement.findUnique({
          where: { orgId_billingCycle: { orgId: org.id, billingCycle: cycle } },
          select: { id: true, finalizedAt: true },
        });
        if (existing?.finalizedAt) {
          return;
        }

        const statement = await tx.billingStatement.upsert({
          where: { orgId_billingCycle: { orgId: org.id, billingCycle: cycle } },
          update: { subtotal, total: subtotal, status: 'draft' },
          create: {
            orgId: org.id,
            billingCycle: cycle,
            status: 'draft',
            subtotal,
            total: subtotal,
          },
        });

        await tx.billingStatementLineItem.deleteMany({
          where: { billingStatementId: statement.id },
        });

        for (const row of sums) {
          const amount = row._sum.amountCharged ?? new Prisma.Decimal('0');
          await tx.billingStatementLineItem.create({
            data: {
              billingStatementId: statement.id,
              eventType: row.eventType,
              description: row.eventType.replace(/_/g, ' '),
              quantity: row._count.id,
              unitPrice: row._count.id > 0 ? amount.div(row._count.id) : new Prisma.Decimal('0'),
              amount,
            },
          });
        }
      });
      statements += 1;
    }

    result.monthly = { billingCycle: cycle, statements };
  }

  return result;
}

