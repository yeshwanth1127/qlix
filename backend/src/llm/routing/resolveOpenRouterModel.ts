import type { InferenceChatRequest } from '../inferenceSchemas.js';
import { normalizeQlixInferenceModelId } from '../modelPolicy.js';
import { isQlixAutoModelId, selectInferenceModel } from './selectModel.js';

export interface ResolveOpenRouterModelOptions {
  /** Org plan tiers; defaults to economy + standard when unknown. */
  planAllowedTiers?: string[];
}

/**
 * Map Qlix virtual Auto ids (`openrouter/qlix/auto`, …) to a concrete OpenRouter model id
 * (without the `openrouter/` prefix). Pinned models pass through unchanged.
 */
export function resolveOpenRouterApiModel(
  request: Pick<InferenceChatRequest, 'model' | 'messages' | 'tools'>,
  options?: ResolveOpenRouterModelOptions,
): string {
  const requested = normalizeQlixInferenceModelId(request.model);
  if (!isQlixAutoModelId(requested)) {
    return requested.replace(/^openrouter\//, '');
  }

  const decision = selectInferenceModel({
    requestedModel: requested,
    messages: request.messages as Array<{ role?: string; content?: unknown }>,
    tools: request.tools,
    planAllowedTiers: options?.planAllowedTiers ?? ['economy', 'standard'],
    routingEnabled: true,
  });

  return decision.routedModel.replace(/^openrouter\//, '');
}
