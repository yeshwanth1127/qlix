export { scoreComplexity, type ComplexityResult } from './complexity.js';
export {
  AUTO_LADDER,
  QLIX_AUTO_MODEL_IDS,
  TIER_RANK,
  isQlixAutoModelId,
  maxTierInPlan,
  minTier,
  modelsAllowedForAuto,
  resolveAutoBillableTier,
  tierForModelId,
  type ModelTierKey,
} from './ladder.js';
export { selectInferenceModel, type RouteDecision } from './selectModel.js';
export {
  resolveOpenRouterApiModel,
  type ResolveOpenRouterModelOptions,
} from './resolveOpenRouterModel.js';

export function isModelRoutingEnabled(): boolean {
  const raw = process.env.QLIX_MODEL_ROUTING_ENABLED?.trim().toLowerCase();
  if (raw === 'false' || raw === '0') return false;
  return true;
}
