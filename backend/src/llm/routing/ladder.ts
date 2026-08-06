/**
 * Auto model ladder — curated from live OpenRouter rates (2026-08).
 *
 * Economy: google/gemini-2.5-flash-lite (~$0.19/M blended) — tools + 1M ctx
 * Standard ceiling: openai/gpt-4o-mini (~$0.29/M blended) — proven tool-caller
 *
 * Hard rule: never route above the agent's Auto billable tier.
 */

export type ModelTierKey = 'economy' | 'standard' | 'advanced' | 'premium';

export const TIER_RANK: Record<ModelTierKey, number> = {
  economy: 0,
  standard: 1,
  advanced: 2,
  premium: 3,
};

export const QLIX_AUTO_MODEL_IDS = {
  auto: 'openrouter/qlix/auto',
  economy: 'openrouter/qlix/auto-economy',
  standard: 'openrouter/qlix/auto-standard',
} as const;

/** Concrete OpenRouter ids (with openrouter/ prefix) available to Auto per tier. */
export const AUTO_LADDER: ReadonlyArray<{
  tier: ModelTierKey;
  modelId: string;
  openRouterId: string;
}> = [
  {
    tier: 'economy',
    modelId: 'openrouter/google/gemini-2.5-flash-lite',
    openRouterId: 'google/gemini-2.5-flash-lite',
  },
  {
    tier: 'standard',
    modelId: 'openrouter/openai/gpt-4o-mini',
    openRouterId: 'openai/gpt-4o-mini',
  },
];

const TIER_PREFIXES: ReadonlyArray<{ tier: ModelTierKey; prefixes: string[] }> = [
  {
    tier: 'economy',
    prefixes: [
      'openrouter/google/gemini-flash',
      'openrouter/google/gemini-2.0-flash',
      'openrouter/google/gemini-2.5-flash',
      'openrouter/anthropic/claude-haiku',
      'openrouter/anthropic/claude-3-haiku',
      'openrouter/meta-llama/llama-3',
      'openrouter/mistralai/mistral-7b',
      'openrouter/mistralai/mistral-small',
      'openrouter/qlix/auto-economy',
    ],
  },
  {
    tier: 'standard',
    prefixes: [
      'openrouter/anthropic/claude-sonnet',
      'openrouter/openai/gpt-4o-mini',
      'openrouter/google/gemini-pro',
      'openrouter/google/gemini-1.5-pro',
      'openrouter/qlix/auto',
      'openrouter/qlix/auto-standard',
    ],
  },
  {
    tier: 'advanced',
    prefixes: [
      'openrouter/openai/gpt-4o',
      'openrouter/openai/gpt-4-turbo',
      'openrouter/google/gemini-2.0-pro',
      'openrouter/anthropic/claude-opus',
    ],
  },
  {
    tier: 'premium',
    prefixes: [
      'openrouter/anthropic/claude-opus-4',
      'openrouter/openai/o1',
      'openrouter/openai/o3',
      'openrouter/google/gemini-ultra',
    ],
  },
];

export function isQlixAutoModelId(model: string): boolean {
  const n = model.trim().toLowerCase();
  return (
    n === QLIX_AUTO_MODEL_IDS.auto ||
    n === QLIX_AUTO_MODEL_IDS.economy ||
    n === QLIX_AUTO_MODEL_IDS.standard ||
    n === 'qlix/auto' ||
    n === 'openrouter/qlix/auto'
  );
}

/** Map a model id to our billing/capability tier (prefix match, economy fallback). */
export function tierForModelId(modelId: string): ModelTierKey {
  const normalized = modelId.trim().toLowerCase().startsWith('openrouter/')
    ? modelId.trim().toLowerCase()
    : `openrouter/${modelId.trim().toLowerCase()}`;

  // Prefer more specific / higher tiers when prefixes overlap (e.g. gpt-4o vs gpt-4o-mini).
  let best: ModelTierKey | null = null;
  let bestPrefixLen = -1;
  for (const row of TIER_PREFIXES) {
    for (const prefix of row.prefixes) {
      if (normalized.startsWith(prefix.toLowerCase()) && prefix.length > bestPrefixLen) {
        // gpt-4o-mini must not match gpt-4o advanced prefix: check longer match wins
        best = row.tier;
        bestPrefixLen = prefix.length;
      }
    }
  }
  return best ?? 'economy';
}

export function maxTierInPlan(allowed: string[]): ModelTierKey {
  let max: ModelTierKey = 'economy';
  for (const t of allowed) {
    const key = t as ModelTierKey;
    if (key in TIER_RANK && TIER_RANK[key] > TIER_RANK[max]) max = key;
  }
  return max;
}

export function minTier(a: ModelTierKey, b: ModelTierKey): ModelTierKey {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}

/**
 * Resolve Auto billable (= max route) tier.
 * Default product ceiling is standard; free/trial plan max economy narrows it.
 */
export function resolveAutoBillableTier(params: {
  requestedModel: string;
  planAllowedTiers: string[];
}): ModelTierKey {
  const planMax = maxTierInPlan(params.planAllowedTiers);
  const raw = params.requestedModel.trim().toLowerCase();
  let agentCeiling: ModelTierKey = 'standard';
  if (raw.includes('auto-economy') || raw === 'qlix/auto-economy') {
    agentCeiling = 'economy';
  } else if (raw.includes('auto-standard')) {
    agentCeiling = 'standard';
  } else if (isQlixAutoModelId(raw)) {
    agentCeiling = 'standard';
  }
  return minTier(agentCeiling, planMax);
}

export function modelsAllowedForAuto(billableTier: ModelTierKey): typeof AUTO_LADDER {
  const maxRank = TIER_RANK[billableTier];
  return AUTO_LADDER.filter((s) => TIER_RANK[s.tier] <= maxRank);
}
