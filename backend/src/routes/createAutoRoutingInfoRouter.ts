import { Router, type Request, type Response } from 'express';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { AUTO_LADDER, QLIX_AUTO_MODEL_IDS } from '../llm/routing/ladder.js';
import { getUsdInrRate } from '../llm/fxRate.js';
import { fetchOpenRouterModelCatalog } from '../llm/openrouterCatalog.js';

/**
 * Auto ladder + live OpenRouter rates for the models we actually route to.
 */
export function createAutoRoutingInfoRouter(): Router {
  const router = Router();

  router.get('/auto-ladder', authenticateUser(true), async (_request: Request, response: Response) => {
    try {
      const [catalog, fx] = await Promise.all([fetchOpenRouterModelCatalog(), getUsdInrRate()]);
      const byId = new Map(catalog.map((m) => [m.id, m]));

      const slots = AUTO_LADDER.map((slot) => {
        const live = byId.get(slot.openRouterId);
        const blend = live?.blendUsdPer1M ?? null;
        return {
          tier: slot.tier,
          qlixModelId: slot.modelId,
          openRouterId: slot.openRouterId,
          blendUsdPer1M: blend,
          blendInrPer1M: blend != null ? Number((blend * fx.rate).toFixed(4)) : null,
          promptUsdPerToken: live?.promptUsdPerToken ?? null,
          completionUsdPerToken: live?.completionUsdPerToken ?? null,
          supportsTools: live?.supportsTools ?? null,
          contextLength: live?.contextLength ?? null,
        };
      });

      response.json({
        autoModelIds: QLIX_AUTO_MODEL_IDS,
        billableEqualsMaxRoute: true,
        defaultBillableTier: 'standard',
        slots,
        fx: { base: 'USD', quote: 'INR', rate: fx.rate, asOf: fx.asOf, source: fx.source },
      });
    } catch (error) {
      console.error('[inference/auto-ladder]', error);
      response.status(502).json({
        error: { code: 'auto_ladder_failed', message: 'Failed to load Auto ladder pricing' },
      });
    }
  });

  return router;
}
