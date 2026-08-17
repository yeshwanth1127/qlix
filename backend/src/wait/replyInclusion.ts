/**
 * Which classified replies earn a place in a wait's live artifact.
 *
 * This is deliberately channel-agnostic: it takes a run goal and a classification label and
 * says nothing about WhatsApp, Telegram, email or any other inbound transport. Any wait
 * trigger that classifies replies can share it.
 */
import type { ReplyInterestLabel } from './waitPolicy.types.js';

export const ALL_REPLY_LABELS: ReplyInterestLabel[] = ['interested', 'unclear', 'not_interested'];

/** Used when the goal says nothing about who to record: engaged leads only. */
export const DEFAULT_REPLY_INCLUSION: ReplyInterestLabel[] = ['interested', 'unclear'];

const REPLY_NOUN = String.raw`(?:repl(?:y|ies)|response(?:s)?|answer(?:s)?|lead(?:s)?|contact(?:s)?|respondent(?:s)?)`;
const RECORD_VERB = String.raw`(?:put|add|includ\w*|log|record|captur\w*|collect\w*|list|track|save|writ\w*|sheet|report)`;

/**
 * "once all replies are received" is a *waiting* condition, not an instruction about sheet
 * contents. Without this guard the quantifier in that clause reads as "record everyone".
 */
const WAIT_CONDITION_QUANTIFIER = new RegExp(
  String.raw`\b(?:once|until|till|after|when|whenever|as soon as)\s+(?:\w+\s+){0,2}(?:all|every|each)\s+(?:\w+\s+){0,1}${REPLY_NOUN}\b`,
  'gi',
);

/** Explicit "everyone, regardless of answer" phrasing. */
const INCLUDE_ALL_PHRASES = [
  new RegExp(String.raw`\b(?:regardless|irrespective)\s+of\b[\s\S]{0,40}\b(?:interest|answer|reply|response)`, 'i'),
  new RegExp(String.raw`\bwhether\s+(?:or\s+not\s+)?(?:they|the\s+lead)\b[\s\S]{0,40}\b(?:interested|yes|no)\b`, 'i'),
  new RegExp(String.raw`\b(?:interested\s+or\s+not|yes\s+or\s+no|positive\s+or\s+negative)\b`, 'i'),
  new RegExp(String.raw`\bincluding\b[\s\S]{0,30}\b(?:declin\w+|reject\w+|not\s+interested|no'?s|negatives?)\b`, 'i'),
  new RegExp(String.raw`\beven\s+(?:if|those\s+who|the\s+ones\s+who)\b[\s\S]{0,30}\b(?:say\s+no|declin\w+|refus\w+|not\s+interested)\b`, 'i'),
  new RegExp(String.raw`\b(?:both)\b[\s\S]{0,30}\b(?:interested\s+and\s+not|yes\s+and\s+no)\b`, 'i'),
];

/** "put every reply in the sheet" — a quantifier governing a reply noun in a recording clause. */
const RECORD_EVERY_REPLY = new RegExp(
  String.raw`\b${RECORD_VERB}\b[\s\S]{0,60}?\b(?:all|every|each)\s+(?:\w+\s+){0,1}${REPLY_NOUN}\b`,
  'i',
);

const ONLY_NEAR = String.raw`\b(?:only|just|nothing\s+but|exclusively)\b`;

/** "only the ones who declined" */
const ONLY_DECLINED_PHRASES = [
  new RegExp(`${ONLY_NEAR}[\\s\\S]{0,40}\\b(?:declin\\w+|reject\\w+|not\\s+interested|uninterested|negatives?|no'?s)\\b`, 'i'),
  new RegExp(`${ONLY_NEAR}[\\s\\S]{0,40}\\b(?:who|that|the\\s+ones)\\b[\\s\\S]{0,20}\\b(?:said?|say|replied|answered)\\s+(?:a\\s+)?["']?no\\b`, 'i'),
  new RegExp(String.raw`\b(?:declin\w+|not\s+interested|uninterested)\s+(?:leads?|contacts?|replies|responses)\s+only\b`, 'i'),
];

/**
 * "only the interested ones". The lookbehind keeps "not interested" from reading as a match
 * for the positive word buried inside it.
 */
const INTERESTED_WORD = String.raw`(?:(?<!\bnot )\binterested\b|\bqualified\b|\bpositives?\b|\byes(?:es)?\b)`;

const ONLY_INTERESTED_PHRASES = [
  new RegExp(`${ONLY_NEAR}[\\s\\S]{0,40}${INTERESTED_WORD}`, 'i'),
  new RegExp(`${ONLY_NEAR}[\\s\\S]{0,40}\\b(?:who|that|the\\s+ones)\\b[\\s\\S]{0,20}\\b(?:said?|say|replied|answered)\\s+(?:a\\s+)?["']?yes\\b`, 'i'),
  new RegExp(
    String.raw`(?:(?<!\bnot )\binterested\b|\bqualified\b)\s+(?:leads?|contacts?|replies|responses)\s+only\b`,
    'i',
  ),
];

function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Read the run goal and decide which reply classifications belong in the live artifact.
 * Falls back to {@link DEFAULT_REPLY_INCLUSION} whenever the goal is silent or contradictory.
 */
export function inferReplyInclusionFromGoal(goal: string): ReplyInterestLabel[] {
  const text = String(goal ?? '').trim();
  if (!text) return [...DEFAULT_REPLY_INCLUSION];

  // Narrowing beats widening: "only the interested ones" is a more specific instruction
  // than a stray "all replies" elsewhere in the same goal.
  const onlyDeclined = anyMatch(ONLY_DECLINED_PHRASES, text);
  const onlyInterested = anyMatch(ONLY_INTERESTED_PHRASES, text);
  if (onlyDeclined && !onlyInterested) return ['not_interested'];
  if (onlyInterested && !onlyDeclined) return ['interested'];
  if (onlyInterested && onlyDeclined) return [...ALL_REPLY_LABELS];

  if (anyMatch(INCLUDE_ALL_PHRASES, text)) return [...ALL_REPLY_LABELS];

  // Strip wait-condition clauses before looking for "record every reply", so
  // "send it once all replies are received" does not read as a content rule.
  const withoutWaitClauses = text.replace(WAIT_CONDITION_QUANTIFIER, ' ');
  if (RECORD_EVERY_REPLY.test(withoutWaitClauses)) return [...ALL_REPLY_LABELS];

  return [...DEFAULT_REPLY_INCLUSION];
}

/** Coerce persisted/config values into a valid label list; null when unusable. */
export function normalizeReplyInclusion(value: unknown): ReplyInterestLabel[] | null {
  if (!Array.isArray(value)) return null;
  const labels = value.filter((entry): entry is ReplyInterestLabel =>
    typeof entry === 'string' && (ALL_REPLY_LABELS as string[]).includes(entry),
  );
  const deduped = [...new Set(labels)];
  return deduped.length > 0 ? deduped : null;
}

/** Does this classification belong in the artifact under the given policy? */
export function replyIncluded(
  label: ReplyInterestLabel,
  include: ReplyInterestLabel[] = DEFAULT_REPLY_INCLUSION,
): boolean {
  return include.includes(label);
}

const LABEL_WORDS: Record<ReplyInterestLabel, string> = {
  interested: 'interested',
  unclear: 'unclear',
  not_interested: 'not interested',
};

/** Plain-language policy line for agent prompts and run findings. */
export function describeReplyInclusion(
  include: ReplyInterestLabel[] = DEFAULT_REPLY_INCLUSION,
): string {
  const excluded = ALL_REPLY_LABELS.filter((label) => !include.includes(label));
  if (excluded.length === 0) return 'record every reply, whatever the answer';
  const list = (labels: ReplyInterestLabel[]) =>
    labels.map((label) => LABEL_WORDS[label]).join(' + ');
  return `record ${list(include)}; leave out ${list(excluded)}`;
}
