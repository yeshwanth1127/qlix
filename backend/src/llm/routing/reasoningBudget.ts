/**
 * Reasoning budget control.
 *
 * OpenRouter's `effort` is a *share* of `max_tokens` — roughly 95% for max/xhigh,
 * 80% for high, 50% for medium, 20% for low, 10% for minimal, and 0 for none.
 * A model left on its own default (deepseek-v4-pro defaults to `high`) can spend
 * the whole completion budget thinking and return an empty answer with
 * `finish_reason: "length"`, which is billed in full because reasoning tokens are
 * output tokens.
 *
 * We therefore keep reasoning ON but hold it to a small share, so the model still
 * thinks and still has room to answer.
 */

import {
  cachedReasoningMeta,
  type OpenRouterReasoningMeta,
} from '../openrouterCatalog.js';

export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Ascending share of the completion budget spent thinking. */
const EFFORT_RANK: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
};

/**
 * `agent` — worker and chat tool loops; thinking helps, so keep a small share.
 * `planning` — commander/supervisor JSON; same, but needs a bigger floor to split.
 * `micro` — classifiers and field-namers with budgets under a few hundred tokens;
 *   there is no room to think, so reasoning is switched off.
 */
export type ReasoningPurpose = 'agent' | 'planning' | 'micro';

/** Smallest budget that can be meaningfully split between thinking and answering. */
export const PLANNING_MIN_MAX_TOKENS = 4096;

/** Absolute thinking allowance for models that accept `reasoning.max_tokens`. */
const REASONING_MAX_TOKENS_FLOOR = 1024;

/**
 * Extra completion budget for reasoning models we cannot bound by effort, so a
 * long think still leaves room for the answer.
 */
export const REASONING_HEADROOM_TOKENS = 4096;

const ABSOLUTE_MAX_TOKENS = 32_768;

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

export function parseReasoningEffort(value: unknown): ReasoningEffort | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return isReasoningEffort(normalized) ? normalized : null;
}

function envEffort(name: string): ReasoningEffort | null {
  return parseReasoningEffort(process.env[name]);
}

/** Default share per purpose, overridable without a redeploy. */
function defaultEffortForPurpose(purpose: ReasoningPurpose): ReasoningEffort {
  if (purpose === 'micro') return envEffort('QLIX_REASONING_EFFORT_MICRO') ?? 'none';
  if (purpose === 'planning') return envEffort('QLIX_REASONING_EFFORT_PLANNING') ?? 'low';
  return envEffort('QLIX_REASONING_EFFORT_AGENT') ?? 'low';
}

/**
 * Models that reason but are not in the catalog cache yet. Only used on a cold
 * cache; the catalog is authoritative once warm.
 */
const STATIC_REASONING_PATTERNS: RegExp[] = [
  /deepseek-(?:r1|v4-pro)/i,
  /\bnvidia\/nemotron/i,
  /\bopenai\/o[1-9]\b/i,
  /:thinking$/i,
  /-thinking\b/i,
  /\bqwq\b/i,
  /magistral/i,
];

function looksLikeReasoningModel(modelId: string): boolean {
  return STATIC_REASONING_PATTERNS.some((re) => re.test(modelId));
}

/**
 * True when the model may spend output tokens on hidden reasoning. Unknown models
 * are judged by name so a cold catalog still gets headroom.
 */
export function isReasoningModelId(modelId: string): boolean {
  const { known, reasoning } = cachedReasoningMeta(modelId);
  if (known) return reasoning != null;
  return looksLikeReasoningModel(modelId);
}

/** Pick the effort the model actually accepts, at or below what we asked for. */
function clampToSupported(
  wanted: ReasoningEffort,
  meta: OpenRouterReasoningMeta,
): ReasoningEffort | null {
  const supported = meta.supportedEfforts;
  if (supported == null) return wanted;
  const usable = supported
    .map((value) => parseReasoningEffort(value))
    .filter((value): value is ReasoningEffort => value != null)
    .sort((a, b) => EFFORT_RANK[a] - EFFORT_RANK[b]);
  if (usable.length === 0) return null;
  const atOrBelow = usable.filter((value) => EFFORT_RANK[value] <= EFFORT_RANK[wanted]);
  // Nothing that low is offered (deepseek-v4-pro offers only max/high/low), so
  // take the smallest share on offer rather than silently accepting the default.
  return atOrBelow.length > 0 ? atOrBelow[atOrBelow.length - 1]! : usable[0]!;
}

/** The `reasoning` object to send, or null to omit it entirely. */
export type ReasoningControl =
  | { effort: ReasoningEffort; exclude: true }
  | { max_tokens: number; exclude: true }
  | { enabled: false }
  | null;

export interface ResolvedReasoning {
  reasoning: ReasoningControl;
  /** Completion budget after any headroom for unbounded thinking. */
  maxTokens: number | undefined;
  /** Effort we settled on, for logging. Null when reasoning is off or omitted. */
  effort: ReasoningEffort | null;
}

/**
 * Decide how much thinking a request may do.
 *
 * `requestedEffort` is the user's choice (agent setting, team run override, or an
 * explicit API field) and wins over the per-purpose default.
 */
export function resolveReasoning(params: {
  modelId: string;
  purpose: ReasoningPurpose;
  maxTokens?: number | null;
  requestedEffort?: ReasoningEffort | null;
}): ResolvedReasoning {
  const { modelId, purpose } = params;
  const requested = params.maxTokens ?? undefined;
  // A planning call must fit a structured answer *after* thinking, so give it a
  // budget big enough to split before working out shares.
  const budget =
    purpose === 'planning' && requested != null
      ? planningMaxTokens(requested, modelId)
      : requested;

  // Exora aliases do not accept OpenRouter's reasoning parameter.
  if (modelId.trim().toLowerCase().startsWith('exora/')) {
    return { reasoning: null, maxTokens: budget, effort: null };
  }

  const { known, reasoning: meta } = cachedReasoningMeta(modelId);
  if (known && meta == null) {
    // Catalog says this model has no thinking tokens (e.g. gpt-4o-mini).
    return { reasoning: null, maxTokens: budget, effort: null };
  }

  const wanted = params.requestedEffort ?? defaultEffortForPurpose(purpose);

  if (!meta) {
    // Cold cache. Send nothing (an unsupported field can 400 some providers) and
    // rely on headroom so a long think still leaves room to answer.
    return {
      reasoning: null,
      maxTokens: looksLikeReasoningModel(modelId) ? withReasoningHeadroom(budget, modelId) : budget,
      effort: null,
    };
  }

  // An absolute allowance is clearer than a percentage when the model supports it:
  // "think for ~1024 tokens then answer", regardless of the output budget.
  if (meta.supportsMaxTokens && wanted !== 'none') {
    const share = budget ? Math.floor(budget * 0.25) : REASONING_MAX_TOKENS_FLOOR;
    return {
      reasoning: { max_tokens: Math.max(REASONING_MAX_TOKENS_FLOOR, share), exclude: true },
      maxTokens: budget,
      effort: null,
    };
  }

  if (wanted === 'none') {
    if (meta.mandatory) {
      // Cannot be turned off; hold it to the smallest offered share instead.
      const fallback = clampToSupported('minimal', meta);
      return fallback
        ? { reasoning: { effort: fallback, exclude: true }, maxTokens: budget, effort: fallback }
        : { reasoning: null, maxTokens: withReasoningHeadroom(budget, modelId), effort: null };
    }
    const off = clampToSupported('none', meta);
    return off === 'none'
      ? { reasoning: { effort: 'none', exclude: true }, maxTokens: budget, effort: 'none' }
      : { reasoning: { enabled: false }, maxTokens: budget, effort: 'none' };
  }

  const effort = clampToSupported(wanted, meta);
  if (!effort) {
    // Reasoning exists but effort selection is not exposed (nemotron reports only
    // `{"mandatory": false}`), so the only lever left is a bigger budget.
    return { reasoning: null, maxTokens: withReasoningHeadroom(budget, modelId), effort: null };
  }
  return { reasoning: { effort, exclude: true }, maxTokens: budget, effort };
}

/** Add room for thinking we could not bound, capped at the request ceiling. */
export function withReasoningHeadroom(
  maxTokens: number | undefined,
  modelId: string,
): number | undefined {
  if (maxTokens == null) return maxTokens;
  if (!isReasoningModelId(modelId)) return maxTokens;
  return Math.min(ABSOLUTE_MAX_TOKENS, maxTokens + REASONING_HEADROOM_TOKENS);
}

/**
 * Raise a budget to something a reasoning model can split between thinking and a
 * structured answer. A 1600-token planning call gives `low` effort only ~320
 * tokens to think in, which is neither useful nor safe.
 */
export function planningMaxTokens(maxTokens: number, modelId: string): number {
  if (!isReasoningModelId(modelId)) return maxTokens;
  return Math.max(maxTokens, PLANNING_MIN_MAX_TOKENS);
}

/**
 * A proven non-reasoning tool-caller, used when a reasoning model has already
 * starved itself once on this task.
 */
export function nonReasoningFallbackModel(modelId: string): string {
  return modelId.trim().toLowerCase().startsWith('exora/')
    ? 'exora/exora-general'
    : 'openrouter/openai/gpt-4o-mini';
}
