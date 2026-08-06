import { scoreComplexity } from './complexity.js';
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
 * Pinned models pass through; Auto picks cheapest capable ≤ billable tier.
 */
export function selectInferenceModel(params: {
  requestedModel: string;
  messages: Array<{ role?: string; content?: unknown }>;
  tools?: unknown;
  planAllowedTiers: string[];
  routingEnabled: boolean;
}): RouteDecision {
  const requested = params.requestedModel.trim();
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
  const allowed = modelsAllowedForAuto(billableTier);
  if (allowed.length === 0) {
    // Should not happen; fall back to cheapest ladder entry within economy
    const fallback = modelsAllowedForAuto('economy')[0]!;
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

  // Prefer standard (or highest allowed) when tools + non-trivial work; else cheapest.
  const needsStrong =
    (toolsPresent && complexity.score >= 0.2) ||
    complexity.score >= 0.55 ||
    Boolean(complexity.signals.has_code);

  let chosen = allowed[0]!;
  if (needsStrong) {
    // Highest tier still ≤ billable
    for (const slot of allowed) {
      if (TIER_RANK[slot.tier] >= TIER_RANK[chosen.tier]) chosen = slot;
    }
  } else {
    // Cheapest = lowest tier first in AUTO_LADDER order
    chosen = allowed[0]!;
  }

  // Never above billable (belt and suspenders)
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
