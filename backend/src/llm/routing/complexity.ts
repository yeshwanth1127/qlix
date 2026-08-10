/** Query complexity scoring — ported from Luna for Auto model selection. */

const CODE_PATTERNS =
  /```|`[^`]+`|\bdef\s|\bclass\s|\bimport\s|\bfunction\s|\bconst\s|\bvar\s|\blet\s|\bif\s*\(|->|=>|\{\s*\}|\bfor\s+\w+\s+in\s|#include|System\.out/i;
const MATH_PATTERNS =
  /\bsolve\b|\bintegral\b|\bequation\b|\bproof\b|\bderivative\b|\bmatrix\b|\btheorem\b|\bcalculate\b|\bcompute\b|\bprobability\b/i;
const REASONING_PATTERNS =
  /\bexplain\b|\banalyze\b|\bcompare\b|\bwhy\b|\bstep[- ]by[- ]step\b|\breason\b|\bthink\b|\bpros\s+and\s+cons\b|\btrade-?\s*offs?\b|\bevaluate\b/i;
const MULTI_STEP_PATTERNS =
  /\bthen\b.*\bthen\b|\bfirst\b.*\bnext\b|\bstep\s*\d|\b(?:and\s+also|additionally|furthermore)\b|\b\d+\.\s/is;
const CREATIVE_PATTERNS =
  /\bwrite\b.*\b(?:essay|story|article|report|poem)\b|\bgenerate\b.*\b(?:code|script|program)\b|\bcreate\b|\bdesign\b|\bdraft\b|\bcompose\b/i;

const TOKEN_TIERS: Record<string, number> = {
  trivial: 1024,
  simple: 2048,
  moderate: 4096,
  complex: 8192,
  very_complex: 16384,
};

export interface ComplexityResult {
  score: number;
  tier: string;
  suggestedMaxTokens: number;
  signals: Record<string, unknown>;
}

function countQuestions(query: string): number {
  return (query.match(/\?/g) ?? []).length;
}

function countSubTasks(query: string): number {
  const numbered = (query.match(/^\s*\d+[.)]\s/gm) ?? []).length;
  const bulleted = (query.match(/^\s*[-*]\s/gm) ?? []).length;
  return numbered + bulleted;
}

export function scoreComplexity(query: string): ComplexityResult {
  const signals: Record<string, unknown> = {};
  let score = 0;

  const length = query.length;
  let lengthScore = 0;
  if (length >= 800) lengthScore = 1;
  else if (length >= 300) lengthScore = 0.8;
  else if (length >= 100) lengthScore = 0.6;
  else if (length >= 20) lengthScore = 0.3;
  signals.length = lengthScore;
  score += 0.2 * lengthScore;

  const hasCode = CODE_PATTERNS.test(query);
  const hasMath = MATH_PATTERNS.test(query);
  let domainScore = 0;
  if (hasCode) domainScore = Math.max(domainScore, 0.7);
  if (hasMath) domainScore = Math.max(domainScore, 0.8);
  if (hasCode && hasMath) domainScore = 1;
  signals.domain = domainScore;
  signals.has_code = hasCode;
  signals.has_math = hasMath;
  score += 0.25 * domainScore;

  const hasReasoning = REASONING_PATTERNS.test(query);
  const hasMultiStep = MULTI_STEP_PATTERNS.test(query);
  let reasoningScore = 0;
  if (hasReasoning) reasoningScore = 0.6;
  if (hasMultiStep) reasoningScore = Math.max(reasoningScore, 0.8);
  if (hasReasoning && hasMultiStep) reasoningScore = 1;
  signals.reasoning = reasoningScore;
  signals.has_reasoning = hasReasoning;
  signals.has_multi_step = hasMultiStep;
  score += 0.25 * reasoningScore;

  const multiPart = countQuestions(query) + countSubTasks(query);
  const multiScore = multiPart <= 1 ? 0 : multiPart <= 3 ? 0.5 : 1;
  signals.multi_part = multiScore;
  score += 0.15 * multiScore;

  const hasCreative = CREATIVE_PATTERNS.test(query);
  const creativeScore = hasCreative ? 0.7 : 0;
  signals.creative = creativeScore;
  signals.has_creative = hasCreative;
  score += 0.15 * creativeScore;

  score = Math.max(0, Math.min(1, score));

  let tier: string;
  if (score < 0.15) tier = 'trivial';
  else if (score < 0.3) tier = 'simple';
  else if (score < 0.55) tier = 'moderate';
  else if (score < 0.8) tier = 'complex';
  else tier = 'very_complex';

  return {
    score: Math.round(score * 1000) / 1000,
    tier,
    suggestedMaxTokens: TOKEN_TIERS[tier] ?? 4096,
    signals,
  };
}
