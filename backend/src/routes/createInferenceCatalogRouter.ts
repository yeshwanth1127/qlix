import { Router, type Request, type Response } from 'express';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { fetchOpenRouterModelCatalog } from '../llm/openrouterCatalog.js';
import { OpenRouterConfigError } from '../llm/openrouterClient.js';
import { fetchExoraModelCatalog } from '../llm/exoraModelCatalog.js';
import {
  defaultLlmProvider,
  isLlmProviderConfigured,
  type LlmProviderId,
} from '../llm/inferenceRouter.js';
import { InferenceConfigError } from '../llm/providers/types.js';

export function createInferenceCatalogRouter(): Router {
  const router = Router();

  async function sendModels(provider: LlmProviderId, response: Response): Promise<void> {
    try {
      if (provider === 'exora') {
        const models = await fetchExoraModelCatalog();
        response.json({
          provider,
          models: models.map((model) => ({
            id: model.id,
            name: model.name,
            contextLength: model.contextLength ?? null,
            qlixModelId: model.id.toLowerCase().startsWith('exora/')
              ? model.id
              : `exora/${model.id}`,
            promptUsdPerToken: null,
            completionUsdPerToken: null,
            blendUsdPer1M: null,
            supportsTools: model.supportsTools ?? null,
          })),
        });
        return;
      }
      const models = await fetchOpenRouterModelCatalog();
      response.json({
        provider,
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
      if (err instanceof OpenRouterConfigError || err instanceof InferenceConfigError) {
        response.status(503).json({
          error: {
            code: 'inference_not_configured',
            message: err.message,
          },
        });
        return;
      }
      console.error(`${provider}-models error`, err);
      response.status(502).json({
        error: {
          code: `${provider}_models_fetch_failed`,
          message: err instanceof Error ? err.message : `Failed to load models from ${provider}`,
        },
      });
    }
  }

  router.get('/models', authenticateUser(true), async (request: Request, response: Response) => {
    const provider = request.query.provider === 'exora' ? 'exora' : 'openrouter';
    await sendModels(provider, response);
  });

  router.get('/openrouter-models', authenticateUser(true), async (_request: Request, response: Response) => {
    await sendModels('openrouter', response);
  });

  router.get('/capabilities', authenticateUser(true), (_request: Request, response: Response) => {
    response.json({
      defaultProvider: defaultLlmProvider(),
      providers: {
        exora: { enabled: isLlmProviderConfigured('exora') },
        openrouter: { enabled: isLlmProviderConfigured('openrouter') },
      },
    });
  });

  return router;
}
