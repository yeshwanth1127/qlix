/**
 * Margin Cascade — free-first Auto routing with escalate + Decision Brief.
 *
 * Scout: OpenRouter Free Models Router (`openrouter/free`)
 * Paid: existing AUTO_LADDER (Flash-Lite → 4o-mini), plan-capped
 */

import { scoreComplexity } from './complexity.js';
import {
  AUTO_LADDER,
  TIER_RANK,
  type ModelTierKey,
  modelsAllowedForAuto,
} from './ladder.js';

export const OPENROUTER_FREE_ROUTER = 'openrouter/free';

export type CascadePhase = 'scout' | 'paid';

export type CascadeEscalateReason =
  | 'synthesis'
  | 'high_complexity'
  | 'tool_failures'
  | 'length_retry_exhausted'
  | 'free_unhealthy'
  | 'forced'
  | 'none';

export interface CascadeHints {
  phase?: CascadePhase;
  /** Runner asks to leave scout (or re-pick after limit). */
  forceHandoff?: boolean;
  escalateReason?: CascadeEscalateReason;
  /** Consecutive free/scout failures this run. */
  scoutFailures?: number;
  /** True when this round expects a final answer (no tools / finalize nudge). */
  synthesisRound?: boolean;
}

export function isMarginCascadeEnabled(): boolean {
  const raw = process.env.QLIX_MARGIN_CASCADE_ENABLED?.trim().toLowerCase();
  if (raw === 'false' || raw === '0') return false;
  return true;
}

export function isOpenRouterFreeModelId(modelId: string): boolean {
  const n = modelId.trim().toLowerCase();
  return (
    n === OPENROUTER_FREE_ROUTER ||
    n === 'openrouter/openrouter/free' ||
    n.endsWith(':free') ||
    n === 'openrouter/free'
  );
}

export function shouldEscalateToPaid(params: {
  complexityScore: number;
  hasCode: boolean;
  toolsPresent: boolean;
  hints?: CascadeHints;
}): { escalate: boolean; reason: CascadeEscalateReason } {
  const hints = params.hints;
  if (hints?.forceHandoff && hints.phase === 'paid') {
    return { escalate: true, reason: hints.escalateReason ?? 'forced' };
  }
  if (hints?.phase === 'paid') {
    return { escalate: true, reason: hints.escalateReason ?? 'forced' };
  }
  if ((hints?.scoutFailures ?? 0) >= 2) {
    return { escalate: true, reason: 'tool_failures' };
  }
  if (hints?.escalateReason === 'length_retry_exhausted' || hints?.escalateReason === 'free_unhealthy') {
    return { escalate: true, reason: hints.escalateReason };
  }
  if (hints?.synthesisRound) {
    return { escalate: true, reason: 'synthesis' };
  }
  // High complexity / code → paid even mid-tool-loop when not forced scout
  if (params.hasCode || params.complexityScore >= 0.7) {
    return { escalate: true, reason: 'high_complexity' };
  }
  // Default: stay on free scout for tool gathering
  if (params.toolsPresent && params.complexityScore < 0.7) {
    return { escalate: false, reason: 'none' };
  }
  if (params.complexityScore >= 0.55) {
    return { escalate: true, reason: 'high_complexity' };
  }
  return { escalate: false, reason: 'none' };
}

export function pickPaidLadderModel(params: {
  billableTier: ModelTierKey;
  complexityScore: number;
  hasCode: boolean;
  toolsPresent: boolean;
}): { modelId: string; routingTier: ModelTierKey; reason: string } {
  const allowed = modelsAllowedForAuto(params.billableTier, 'openrouter');
  if (allowed.length === 0) {
    const fallback = AUTO_LADDER[0]!;
    return {
      modelId: fallback.modelId,
      routingTier: fallback.tier,
      reason: 'cascade_paid_fallback',
    };
  }
  const needsStrong =
    (params.toolsPresent && params.complexityScore >= 0.2) ||
    params.complexityScore >= 0.55 ||
    params.hasCode;
  let chosen = allowed[0]!;
  if (needsStrong) {
    for (const slot of allowed) {
      if (TIER_RANK[slot.tier] >= TIER_RANK[chosen.tier]) chosen = slot;
    }
  }
  return {
    modelId: chosen.modelId,
    routingTier: chosen.tier,
    reason: needsStrong ? 'cascade_paid_strong' : 'cascade_paid_cheap',
  };
}

/** Classify provider/proxy errors for seamless handoff. */
export function classifyHandoffError(input: {
  statusCode?: number;
  message?: string;
  code?: string;
}): {
  handoff: boolean;
  mode: 'same_history' | 'brief' | 'none';
  reason: CascadeEscalateReason | 'rate_limited' | 'context_overflow' | 'quota_exhausted';
} {
  const status = input.statusCode ?? 0;
  const msg = (input.message ?? '').toLowerCase();
  const code = (input.code ?? '').toLowerCase();

  if (
    status === 429 ||
    code.includes('rate') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  ) {
    return { handoff: true, mode: 'same_history', reason: 'rate_limited' };
  }
  if (
    msg.includes('quota') ||
    msg.includes('free.*limit') ||
    /free.*(limit|exhausted)/i.test(input.message ?? '')
  ) {
    return { handoff: true, mode: 'same_history', reason: 'quota_exhausted' };
  }
  if (
    status === 400 &&
    (msg.includes('context') || msg.includes('maximum') || msg.includes('too long'))
  ) {
    return { handoff: true, mode: 'brief', reason: 'context_overflow' };
  }
  if (status === 502 || status === 503 || status === 504) {
    return { handoff: true, mode: 'same_history', reason: 'free_unhealthy' };
  }
  return { handoff: false, mode: 'none', reason: 'forced' };
}

export interface DecisionBriefInput {
  goal: string;
  facts?: string[];
  artifacts?: string[];
  openQuestions?: string[];
  failedAttempts?: string[];
  maxChars?: number;
}

/** Compact checkpoint so paid models do not inherit full tool dumps. */
export function buildDecisionBrief(input: DecisionBriefInput): string {
  const maxChars = input.maxChars ?? 6000;
  const lines: string[] = [
    '# Decision Brief (cascade handoff)',
    '',
    '## Goal',
    input.goal.trim() || '(not provided)',
  ];
  if (input.facts?.length) {
    lines.push('', '## Facts gathered');
    for (const f of input.facts.slice(0, 40)) lines.push(`- ${f}`);
  }
  if (input.artifacts?.length) {
    lines.push('', '## Artifacts / refs');
    for (const a of input.artifacts.slice(0, 30)) lines.push(`- ${a}`);
  }
  if (input.openQuestions?.length) {
    lines.push('', '## Open questions');
    for (const q of input.openQuestions.slice(0, 15)) lines.push(`- ${q}`);
  }
  if (input.failedAttempts?.length) {
    lines.push('', '## Failed attempts');
    for (const f of input.failedAttempts.slice(0, 10)) lines.push(`- ${f}`);
  }
  lines.push(
    '',
    '## Instructions',
    'Continue from this checkpoint. Do not redo completed tool work.',
    'Call tools only if a fact or artifact must be re-fetched.',
    'Return the final answer when enough information is present.',
  );
  let out = lines.join('\n');
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 20)}\n…[truncated]`;
  return out;
}

/** Extract a rough brief from a chat message list (deterministic, no LLM). */
export function buildDecisionBriefFromMessages(
  messages: Array<{ role?: string; content?: unknown }>,
  maxChars = 6000,
): string {
  let goal = '';
  const facts: string[] = [];
  const artifacts: string[] = [];
  for (const m of messages) {
    const role = m.role;
    const text =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .map((p) =>
                typeof p === 'string'
                  ? p
                  : p && typeof p === 'object' && 'text' in p
                    ? String((p as { text?: unknown }).text ?? '')
                    : '',
              )
              .join('\n')
          : '';
    if (!text) continue;
    if (role === 'user' && !goal) {
      const task = text.match(/Task:\s*([\s\S]+)/i);
      goal = (task?.[1] ?? text).trim().slice(0, 1500);
    }
    if (role === 'tool') {
      const clip = text.replace(/\s+/g, ' ').trim().slice(0, 280);
      if (clip && !clip.startsWith('[cleared:')) facts.push(clip);
      const urls = text.match(/https?:\/\/[^\s)"']+/g) ?? [];
      for (const u of urls.slice(0, 3)) artifacts.push(u);
    }
  }
  return buildDecisionBrief({ goal, facts, artifacts, maxChars });
}

// --- Cost simulation (for tests vs historical RunUsage) ---

/** Approx OpenRouter USD per 1M tokens (input, output). */
export const CASCADE_RATE_USD_PER_1M: Record<string, { in: number; out: number }> = {
  free: { in: 0, out: 0 },
  flash: { in: 0.1, out: 0.4 },
  'flash-lite': { in: 0.1, out: 0.4 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  sonnet: { in: 3, out: 15 },
  stealth: { in: 0, out: 0 },
};

export function estimateUsdFromTokens(
  promptTokens: number,
  completionTokens: number,
  rateKey: keyof typeof CASCADE_RATE_USD_PER_1M,
): number {
  const rate = CASCADE_RATE_USD_PER_1M[rateKey] ?? CASCADE_RATE_USD_PER_1M.flash!;
  return (promptTokens / 1e6) * rate.in + (completionTokens / 1e6) * rate.out;
}

export interface CascadeSimRun {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  model: string;
}

export interface CascadeSimResult {
  runCount: number;
  baselineUsd: number;
  cascadeUsd: number;
  baselineTokensBillable: number;
  cascadeTokensBillable: number;
  usdSaved: number;
  usdSavedPct: number;
  tokensBillableSavedPct: number;
  scoutTokenShare: number;
  paidTokenShare: number;
  perRun: Array<{
    baselineUsd: number;
    cascadeUsd: number;
    scoutTokens: number;
    paidTokens: number;
  }>;
}

/**
 * Simulate margin cascade on historical runs.
 * Scout covers most prompt volume at $0; paid handles a fraction of prompt + all completion
 * (final answer / hard rounds), priced at Flash-Lite unless complexity-like size suggests mini.
 */
export function simulateCascadeSavings(runs: CascadeSimRun[]): CascadeSimResult {
  const perRun: CascadeSimResult['perRun'] = [];
  let baselineUsd = 0;
  let cascadeUsd = 0;
  let baselineTokensBillable = 0;
  let cascadeTokensBillable = 0;
  let scoutTokensTotal = 0;
  let paidTokensTotal = 0;

  for (const run of runs) {
    const prompt = Math.max(0, run.promptTokens);
    const completion = Math.max(0, run.completionTokens);
    const total = prompt + completion || run.totalTokens;

    // Baseline: recorded OpenRouter cost, or estimate as if run used a paid flash model
    // (stealth/$0 logs would otherwise show 0 savings).
    let base = Number(run.totalCostUsd) || 0;
    if (base <= 0) {
      const lower = run.model.toLowerCase();
      if (lower.includes('sonnet') || lower.includes('opus') || lower.includes('gpt-4o')) {
        base = estimateUsdFromTokens(
          prompt,
          completion,
          lower.includes('mini') ? 'gpt-4o-mini' : lower.includes('sonnet') || lower.includes('opus') ? 'sonnet' : 'gpt-4o-mini',
        );
      } else {
        // Treat historical zero-cost stealth as "what Flash would have cost"
        base = estimateUsdFromTokens(prompt, completion, 'flash');
      }
    }

    // Cascade split: ~80% prompt on free scout; remaining prompt + completion on paid
    const scoutPrompt = Math.floor(prompt * 0.8);
    const paidPrompt = prompt - scoutPrompt;
    const complexity = scoreComplexity(`tokens:${total}`);
    const paidKey: keyof typeof CASCADE_RATE_USD_PER_1M =
      total >= 80_000 || complexity.score >= 0.55 ? 'gpt-4o-mini' : 'flash-lite';
    const paidCost = estimateUsdFromTokens(paidPrompt, completion, paidKey);
    const scoutTok = scoutPrompt;
    const paidTok = paidPrompt + completion;

    baselineUsd += base;
    cascadeUsd += paidCost;
    baselineTokensBillable += total;
    cascadeTokensBillable += paidTok;
    scoutTokensTotal += scoutTok;
    paidTokensTotal += paidTok;
    perRun.push({
      baselineUsd: base,
      cascadeUsd: paidCost,
      scoutTokens: scoutTok,
      paidTokens: paidTok,
    });
  }

  const usdSaved = baselineUsd - cascadeUsd;
  const tokenTotal = scoutTokensTotal + paidTokensTotal || 1;
  return {
    runCount: runs.length,
    baselineUsd,
    cascadeUsd,
    baselineTokensBillable,
    cascadeTokensBillable,
    usdSaved,
    usdSavedPct: baselineUsd > 0 ? (usdSaved / baselineUsd) * 100 : 0,
    tokensBillableSavedPct:
      baselineTokensBillable > 0
        ? ((baselineTokensBillable - cascadeTokensBillable) / baselineTokensBillable) * 100
        : 0,
    scoutTokenShare: scoutTokensTotal / tokenTotal,
    paidTokenShare: paidTokensTotal / tokenTotal,
    perRun,
  };
}
