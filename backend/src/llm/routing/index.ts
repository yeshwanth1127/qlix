export { scoreComplexity, type ComplexityResult } from './complexity.js';
export {
  AUTO_LADDER,
  EXORA_AUTO_LADDER,
  EXORA_AUTO_MODEL_IDS,
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
  REASONING_EFFORTS,
  REASONING_HEADROOM_TOKENS,
  PLANNING_MIN_MAX_TOKENS,
  isReasoningEffort,
  isReasoningModelId,
  nonReasoningFallbackModel,
  parseReasoningEffort,
  planningMaxTokens,
  resolveReasoning,
  withReasoningHeadroom,
  type ReasoningEffort,
  type ReasoningPurpose,
  type ResolvedReasoning,
} from './reasoningBudget.js';
export {
  resolveOpenRouterApiModel,
  type ResolveOpenRouterModelOptions,
} from './resolveOpenRouterModel.js';

export function isModelRoutingEnabled(): boolean {
  const raw = process.env.QLIX_MODEL_ROUTING_ENABLED?.trim().toLowerCase();
  if (raw === 'false' || raw === '0') return false;
  return true;
}
