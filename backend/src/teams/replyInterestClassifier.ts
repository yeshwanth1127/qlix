import {
  chatCompletion,
  defaultLlmProvider,
  defaultModelForProvider,
  LLM_APPLICATION_IDS,
} from '../llm/inferenceRouter.js';

export type InterestLabel = 'interested' | 'not_interested' | 'unclear';
export type InterestMethod = 'keyword' | 'llm' | 'default';

export type ReplyInterestInput = {
  jid: string;
  text: string;
};

export type ReplyInterestResult = {
  jid: string;
  text: string;
  label: InterestLabel;
  reason: string;
  method: InterestMethod;
};

const CLASSIFIER_PROVIDER = defaultLlmProvider();
const CLASSIFIER_MODEL = defaultModelForProvider(CLASSIFIER_PROVIDER);
const LLM_PROMPT_CHARS = 400;
const LLM_GOAL_CHARS = 300;

/** Whole-message (after trim/lower) exact shorts that mean interested. */
const INTERESTED_EXACT = new Set([
  'yes',
  'y',
  'yeah',
  'yep',
  'yup',
  'sure',
  'ok',
  'okay',
  'k',
  'kk',
  'interested',
  'sounds good',
  'sound good',
  'go ahead',
  'please share',
  'tell me more',
  'i am interested',
  "i'm interested",
  'yes please',
  'yes interested',
]);

/** Whole-message exact shorts that mean not interested. */
const NOT_INTERESTED_EXACT = new Set([
  'no',
  'n',
  'nope',
  'nah',
  'not interested',
  'no thanks',
  'no thank you',
  'stop',
  'unsubscribe',
  'wrong number',
  'do not contact',
  "don't contact",
  'leave me alone',
  'remove me',
  'not now',
]);

const INTERESTED_PHRASES = [
  /(?<!\bnot )\binterested\b/i,
  /\btell me more\b/i,
  /\bsounds? good\b/i,
  /\bgo ahead\b/i,
  /\bplease share\b/i,
  /\byes\b.+\binterested\b/i,
  /\bi(?:'| a)?m interested\b/i,
  /\bsend (?:me )?(?:more|details|info)\b/i,
];

const NOT_INTERESTED_PHRASES = [
  /\bnot interested\b/i,
  /\bno thanks\b/i,
  /\bno thank you\b/i,
  /\bunsubscribe\b/i,
  /\bwrong number\b/i,
  /\bdon'?t contact\b/i,
  /\bdo not contact\b/i,
  /\bleave me alone\b/i,
  /\bstop (?:texting|messaging|contacting|calling)\b/i,
  /\bremove me\b/i,
  /\bnever contact\b/i,
];

function normalizeReply(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

function keywordHitFamily(normalized: string, original: string): {
  interested: boolean;
  notInterested: boolean;
  reason: string;
} {
  let interested = INTERESTED_EXACT.has(normalized);
  let notInterested = NOT_INTERESTED_EXACT.has(normalized);
  let reason = '';

  if (notInterested) reason = `exact decline "${normalized}"`;
  else if (interested) reason = `exact affirmative "${normalized}"`;

  // Prefer decline phrases first so "not interested" is never double-counted.
  if (!notInterested) {
    for (const re of NOT_INTERESTED_PHRASES) {
      if (re.test(original) || re.test(normalized)) {
        notInterested = true;
        reason = `phrase ${re.source}`;
        break;
      }
    }
  }
  if (!interested && !notInterested) {
    for (const re of INTERESTED_PHRASES) {
      if (re.test(original) || re.test(normalized)) {
        interested = true;
        reason = `phrase ${re.source}`;
        break;
      }
    }
  }

  return { interested, notInterested, reason };
}

/** Keyword-only classify. Returns null when ambiguous (needs LLM). */
export function classifyReplyInterestByKeywords(text: string): Omit<
  ReplyInterestResult,
  'jid' | 'text'
> | null {
  const normalized = normalizeReply(text);
  if (!normalized) {
    return { label: 'unclear', reason: 'empty reply', method: 'keyword' };
  }

  const { interested, notInterested, reason } = keywordHitFamily(normalized, text);
  if (interested && notInterested) return null;
  if (interested) {
    return { label: 'interested', reason: reason || 'keyword match', method: 'keyword' };
  }
  if (notInterested) {
    return { label: 'not_interested', reason: reason || 'keyword match', method: 'keyword' };
  }
  return null;
}

export function shouldIncludeOnSheet(label: InterestLabel): boolean {
  return label === 'interested' || label === 'unclear';
}

async function classifyWithLlm(
  text: string,
  userGoal?: string | null,
): Promise<Omit<ReplyInterestResult, 'jid' | 'text'> | null> {
  const goalSnippet = (userGoal ?? '').trim().slice(0, LLM_GOAL_CHARS);
  const system = `Classify whether a WhatsApp lead is interested in the outreach.
Reply with ONLY one token: interested OR not_interested OR unclear.
- interested: they want more info, said yes, asked a product/pricing/schedule question, or otherwise engage positively
- not_interested: they decline, ask to stop, unsubscribe, or are hostile
- unclear: cannot tell (greetings alone, unrelated chatter, language barrier without clear signal)
${goalSnippet ? `Outreach goal context: ${goalSnippet}` : ''}`.trim();

  try {
    const result = await chatCompletion(
      {
        model: CLASSIFIER_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: text.trim().slice(0, LLM_PROMPT_CHARS) },
        ],
        temperature: 0.1,
        max_tokens: 16,
        stream: false,
      },
      {
        provider: CLASSIFIER_PROVIDER,
        applicationId: LLM_APPLICATION_IDS.replyInterest,
        timeoutMs: 12_000,
        retries: 1,
      },
    );

    const raw = String(result.content ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z_]/g, ' ')
      .trim();
    const token = raw.split(/\s+/)[0] ?? '';
    if (token === 'interested' || token === 'not_interested' || token === 'unclear') {
      return { label: token, reason: 'llm classification', method: 'llm' };
    }
    if (raw.includes('not_interested') || raw.includes('not interested')) {
      return { label: 'not_interested', reason: 'llm classification', method: 'llm' };
    }
    if (raw.includes('interested')) {
      return { label: 'interested', reason: 'llm classification', method: 'llm' };
    }
    if (raw.includes('unclear')) {
      return { label: 'unclear', reason: 'llm classification', method: 'llm' };
    }
    return null;
  } catch (err) {
    console.warn(
      '[reply-interest] LLM classify failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function classifyReplyInterests(
  replies: ReplyInterestInput[],
  opts?: { userGoal?: string | null },
): Promise<ReplyInterestResult[]> {
  const out: ReplyInterestResult[] = [];
  for (const reply of replies) {
    const text = String(reply.text ?? '');
    const byKeyword = classifyReplyInterestByKeywords(text);
    if (byKeyword) {
      out.push({ jid: reply.jid, text, ...byKeyword });
      continue;
    }
    const byLlm = await classifyWithLlm(text, opts?.userGoal);
    if (byLlm) {
      out.push({ jid: reply.jid, text, ...byLlm });
      continue;
    }
    out.push({
      jid: reply.jid,
      text,
      label: 'unclear',
      reason: 'classifier unavailable; default include',
      method: 'default',
    });
  }
  return out;
}

export function formatInterestFindings(results: ReplyInterestResult[]): string {
  const included = results.filter((r) => shouldIncludeOnSheet(r.label));
  const excluded = results.filter((r) => !shouldIncludeOnSheet(r.label));

  const line = (r: ReplyInterestResult) =>
    `- ${r.jid} [${r.label}/${r.method}]: ${JSON.stringify(r.text.slice(0, 280))}${
      r.reason ? ` (${r.reason})` : ''
    }`;

  const parts = [
    'WhatsApp reply interest classification',
    'Sheet policy: include interested + unclear; exclude not_interested.',
    '',
    'Included leads (add these to the sheet):',
    ...(included.length > 0 ? included.map(line) : ['- (none)']),
    '',
    'Excluded leads (do NOT add to the sheet):',
    ...(excluded.length > 0 ? excluded.map(line) : ['- (none)']),
  ];

  const raw = results
    .map(
      (r) =>
        `Contact ${r.jid} replied:\n${r.text}`,
    )
    .join('\n\n');
  if (raw) {
    parts.push('', '--- Raw replies ---', raw);
  }
  return parts.join('\n');
}

export const INTEREST_STAGE_GOAL_APPEND =
  'Act only on "Included leads" from WhatsApp reply classification. Do not add excluded/not_interested contacts to any sheet. ' +
  'If a live artifact URL appears in prior context, use whatsapp_send on that file. Do not call create_xlsx unless no live artifact exists.';

export function summarizeInterestCounts(results: ReplyInterestResult[]): {
  interested: number;
  notInterested: number;
  unclear: number;
  included: number;
} {
  let interested = 0;
  let notInterested = 0;
  let unclear = 0;
  for (const r of results) {
    if (r.label === 'interested') interested += 1;
    else if (r.label === 'not_interested') notInterested += 1;
    else unclear += 1;
  }
  return {
    interested,
    notInterested,
    unclear,
    included: interested + unclear,
  };
}
