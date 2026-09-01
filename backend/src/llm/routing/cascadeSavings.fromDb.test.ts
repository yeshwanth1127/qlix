/**
 * Compare margin-cascade simulated COGS against historical run_usages rows
 * (same shape as backend usage logs / Usage page).
 *
 * Run: npx tsx --test src/llm/routing/cascadeSavings.fromDb.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { simulateCascadeSavings, type CascadeSimRun } from './cascade.js';

describe('cascade savings vs DB RunUsage logs', () => {
  it('reports token and USD reduction from recorded runs', async () => {
    const prisma = new PrismaClient();
    try {
      const rows = await prisma.runUsage.findMany({
        select: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          totalCostUsd: true,
          model: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      assert.ok(rows.length > 0, 'expected run_usages rows in the database');

      const runs: CascadeSimRun[] = rows.map((r) => ({
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        totalTokens: r.totalTokens,
        totalCostUsd: Number(r.totalCostUsd),
        model: r.model,
      }));

      const sim = simulateCascadeSavings(runs);

      // Mirror backend log style for operator readability.
      console.log(
        '[cascade-savings] %s',
        JSON.stringify(
          {
            stage: 'compare_vs_run_usages',
            runCount: sim.runCount,
            baselineUsd: Number(sim.baselineUsd.toFixed(6)),
            cascadeUsd: Number(sim.cascadeUsd.toFixed(6)),
            usdSaved: Number(sim.usdSaved.toFixed(6)),
            usdSavedPct: Number(sim.usdSavedPct.toFixed(1)),
            baselineTokensBillable: sim.baselineTokensBillable,
            cascadeTokensBillable: sim.cascadeTokensBillable,
            tokensBillableSavedPct: Number(sim.tokensBillableSavedPct.toFixed(1)),
            scoutTokenSharePct: Number((sim.scoutTokenShare * 100).toFixed(1)),
            paidTokenSharePct: Number((sim.paidTokenShare * 100).toFixed(1)),
          },
          null,
          2,
        ),
      );

      assert.equal(sim.runCount, rows.length);
      assert.ok(sim.cascadeUsd <= sim.baselineUsd);
      assert.ok(sim.cascadeTokensBillable <= sim.baselineTokensBillable);
      // With 80% scout share, billable tokens should drop materially.
      assert.ok(
        sim.tokensBillableSavedPct >= 40,
        `expected >=40% billable token reduction, got ${sim.tokensBillableSavedPct}`,
      );
      assert.ok(
        sim.usdSavedPct >= 40,
        `expected >=40% USD reduction vs flash baseline, got ${sim.usdSavedPct}`,
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});
