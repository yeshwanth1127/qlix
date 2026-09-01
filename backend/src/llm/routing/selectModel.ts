import { scoreComplexity } from './complexity.js';
import {
  type CascadeEscalateReason,
  type CascadeHints,
  OPENROUTER_FREE_ROUTER,
  isMarginCascadeEnabled,
  isOpenRouterFreeModelId,
  pickPaidLadderModel,
  shouldEscalateToPaid,
} from './cascade.js';
import {
  type ModelTierKey,
  TIER_RANK,
  isQlixAutoModelId,
  modelsAllowedForAuto,
  resolveAutoBillableTier,
} from './ladder.js';

export interface RouteDecision {
  requestedModel: string;
  routedModel: string;
  billableTier: ModelTierKey;
  routingTier: ModelTierKey;
  reason: string;
  complexityScore: number;
  suggestedMaxTokens: number;
  isAuto: boolean;
  cascadePhase?: 'scout' | 'paid';
  cascadeEscalateReason?: CascadeEscalateReason;
}

function lastUserText(messages: Array<{ role?: string; content?: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && 'text' in part) {
            return String((part as { text?: unknown }).text ?? '');
          }
          return '';
        })
        .join('\n');
    }
  }
  return '';
}

function hasTools(tools: unknown): boolean {
  return Array.isArray(tools) && tools.length > 0;
}

/**
 * Select model for an inference request.
 * Auto + margin cascade: scout on openrouter/free, escalate to paid ladder when needed.
 */
export function selectInferenceModel(params: {
  requestedModel: string;
  messages: Array<{ role?: string; content?: unknown }>;
  tools?: unknown;
  planAllowedTiers: string[];
  routingEnabled: boolean;
  cascade?: CascadeHints;
}): RouteDecision {
  const requested = params.requestedModel.trim();
  const provider = requested.toLowerCase().startsWith('exora/') ? 'exora' : 'openrouter';
  const complexity = scoreComplexity(lastUserText(params.messages));
  const toolsPresent = hasTools(params.tools);

  if (!params.routingEnabled || !isQlixAutoModelId(requested)) {
    return {
      requestedModel: requested,
      routedModel: requested,
      billableTier: resolveAutoBillableTier({
        requestedModel: requested,
        planAllowedTiers: params.planAllowedTiers,
      }),
      routingTier: 'standard',
      reason: 'pinned',
      complexityScore: complexity.score,
      suggestedMaxTokens: complexity.suggestedMaxTokens,
      isAuto: false,
    };
  }

  const billableTier = resolveAutoBillableTier({
    requestedModel: requested,
    planAllowedTiers: params.planAllowedTiers,
  });

  // Margin cascade (OpenRouter Auto only): free scout → paid ladder
  if (isMarginCascadeEnabled() && provider === 'openrouter') {
    const { escalate, reason: escReason } = shouldEscalateToPaid({
      complexityScore: complexity.score,
      hasCode: Boolean(complexity.signals.has_code),
      toolsPresent,
      hints: params.cascade,
    });

    if (!escalate) {
      return {
        requestedModel: requested,
        routedModel: OPENROUTER_FREE_ROUTER,
        billableTier,
        routingTier: 'economy',
        reason: 'cascade_scout',
        complexityScore: complexity.score,
        suggestedMaxTokens: complexity.suggestedMaxTokens,
        isAuto: true,
        cascadePhase: 'scout',
        cascadeEscalateReason: 'none',
      };
    }

    const paid = pickPaidLadderModel({
      billableTier,
      complexityScore: complexity.score,
      hasCode: Boolean(complexity.signals.has_code),
      toolsPresent,
    });
    return {
      requestedModel: requested,
      routedModel: paid.modelId,
      billableTier,
      routingTier: paid.routingTier,
      reason: `${paid.reason}:${escReason}`,
      complexityScore: complexity.score,
      suggestedMaxTokens: complexity.suggestedMaxTokens,
      isAuto: true,
      cascadePhase: 'paid',
      cascadeEscalateReason: escReason,
    };
  }

  const allowed = modelsAllowedForAuto(billableTier, provider);
  if (allowed.length === 0) {
    const fallback = modelsAllowedForAuto('economy', provider)[0]!;
    return {
      requestedModel: requested,
      routedModel: fallback.modelId,
      billableTier,
      routingTier: fallback.tier,
      reason: 'auto_empty_fallback',
      complexityScore: complexity.score,
      suggestedMaxTokens: complexity.suggestedMaxTokens,
      isAuto: true,
    };
  }

  const needsStrong =
    (toolsPresent && complexity.score >= 0.2) ||
    complexity.score >= 0.55 ||
    Boolean(complexity.signals.has_code);

  let chosen = allowed[0]!;
  if (needsStrong) {
    for (const slot of allowed) {
      if (TIER_RANK[slot.tier] >= TIER_RANK[chosen.tier]) chosen = slot;
    }
  } else {
    chosen = allowed[0]!;
  }

  if (TIER_RANK[chosen.tier] > TIER_RANK[billableTier]) {
    const capped = [...allowed].reverse().find((s) => TIER_RANK[s.tier] <= TIER_RANK[billableTier]);
    chosen = capped ?? allowed[0]!;
  }

  return {
    requestedModel: requested,
    routedModel: chosen.modelId,
    billableTier,
    routingTier: chosen.tier,
    reason: needsStrong ? 'auto_strong' : 'auto_cheap',
    complexityScore: complexity.score,
    suggestedMaxTokens: complexity.suggestedMaxTokens,
    isAuto: true,
  };
}

export { isQlixAutoModelId, resolveAutoBillableTier } from './ladder.js';
export { scoreComplexity } from './complexity.js';
export {
  OPENROUTER_FREE_ROUTER,
  buildDecisionBrief,
  buildDecisionBriefFromMessages,
  classifyHandoffError,
  isMarginCascadeEnabled,
  isOpenRouterFreeModelId,
  simulateCascadeSavings,
  type CascadeHints,
  type CascadePhase,
} from './cascade.js';
