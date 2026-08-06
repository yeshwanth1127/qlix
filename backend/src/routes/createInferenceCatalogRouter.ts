import { Router, type Request, type Response } from 'express';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { fetchOpenRouterModelCatalog } from '../llm/openrouterCatalog.js';
import { OpenRouterConfigError } from '../llm/openrouterClient.js';

export function createInferenceCatalogRouter(): Router {
  const router = Router();

  router.get('/openrouter-models', authenticateUser(true), async (_request: Request, response: Response) => {
    try {
      const models = await fetchOpenRouterModelCatalog();
      response.json({
        models: models.map((m) => ({
          id: m.id,
          name: m.name,
          contextLength: m.contextLength ?? null,
          qlixModelId: m.id.toLowerCase().startsWith('openrouter/') ? m.id : `openrouter/${m.id}`,
          promptUsdPerToken: m.promptUsdPerToken ?? null,
          completionUsdPerToken: m.completionUsdPerToken ?? null,
          blendUsdPer1M: m.blendUsdPer1M ?? null,
          supportsTools: m.supportsTools ?? null,
        })),
      });
    } catch (err) {
      if (err instanceof OpenRouterConfigError) {
        response.status(503).json({
          error: {
            code: 'inference_not_configured',
            message: err.message,
          },
        });
        return;
      }
      console.error('openrouter-models error', err);
      response.status(502).json({
        error: {
          code: 'openrouter_models_fetch_failed',
          message: err instanceof Error ? err.message : 'Failed to load models from OpenRouter',
        },
      });
    }
  });

  return router;
}
