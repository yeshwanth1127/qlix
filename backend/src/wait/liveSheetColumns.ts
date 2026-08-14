import {
  chatCompletion,
  defaultLlmProvider,
  defaultModelForProvider,
  LLM_APPLICATION_IDS,
} from '../llm/inferenceRouter.js';

const FALLBACK_COLUMNS = ['Name', 'Phone', 'Reply', 'Interest', 'Replied at'];

export type LiveSheetField = 'name' | 'phone' | 'reply' | 'interest' | 'repliedAt';

/** Map a display column header to the semantic field it represents. */
export function resolveLiveSheetField(column: string): LiveSheetField | null {
  const c = column.trim().toLowerCase();
  if (!c) return null;
  // Time columns first — "Reply Time" / "Replied at" must not match the reply field.
  if (
    /\b(replied\s*at|reply\s*time|timestamp|date\s*\/?\s*time)\b/.test(c) ||
    (/\b(time|date|when|timestamp)\b/.test(c) && !/\b(reply|response|message|text|answer)\b/.test(c))
  ) {
    return 'repliedAt';
  }
  if (/\b(name|lead|contact|person|candidate|prospect)\b/.test(c) && !/\b(user|file)\b/.test(c)) {
    return 'name';
  }
  if (/\b(phone|mobile|number|whatsapp|cell)\b/.test(c)) return 'phone';
  if (/\b(interest|sentiment|status|classification|intent)\b/.test(c)) return 'interest';
  if (/\b(reply|response|message|text|answer)\b/.test(c)) return 'reply';
  if (/\b(replied|at)\b/.test(c)) return 'repliedAt';
  return null;
}

/** Best-effort name from outreach copy like "Hi Karthik, …". */
export function inferNameFromOutreachMessage(message: string): string | null {
  const text = String(message ?? '').trim();
  if (!text) return null;
  const match = text.match(
    /^(?:hi|hey|hello|dear|namaste|greetings)[,\s]+([A-Za-z][A-Za-z.'-]{1,40}(?:\s+[A-Za-z][A-Za-z.'-]{1,40})?)\b/i,
  );
  const name = match?.[1]?.trim();
  if (!name) return null;
  if (/^(there|friend|all|team|sir|madam)$/i.test(name)) return null;
  return name.replace(/\s+/g, ' ');
}

function parseColumnsFromLlm(raw: string): string[] | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return null;
    const columns = parsed
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 8);
    if (columns.length < 3) return null;
    const fields = new Set(columns.map((col) => resolveLiveSheetField(col)).filter(Boolean));
    if (!fields.has('reply')) return null;
    return columns;
  } catch {
    return null;
  }
}

/** Ask the LLM for human-friendly sheet headers based on the user's goal. */
export async function inferLiveSheetColumnsFromGoal(goal: string): Promise<string[]> {
  const snippet = goal.trim().slice(0, 1200);
  if (!snippet) return FALLBACK_COLUMNS;

  const provider = defaultLlmProvider();
  const model = defaultModelForProvider(provider);

  try {
    const result = await chatCompletion(
      {
        messages: [
          {
            role: 'system',
            content:
              'You pick spreadsheet column headers for a live WhatsApp reply tracker. ' +
              'Return ONLY a JSON array of 3–6 short header strings (no markdown). ' +
              'Include columns for: contact name, phone/mobile, their reply text, interest level, and reply time. ' +
              'Use natural labels that fit the user goal (e.g. "Lead name", "Mobile", "Response"). ' +
              'Do NOT include JID or internal IDs.',
          },
          {
            role: 'user',
            content: `User goal:\n${snippet}`,
          },
        ],
        model,
        temperature: 0.2,
        max_tokens: 120,
        stream: false,
      },
      { applicationId: LLM_APPLICATION_IDS.nlBuilder, provider, timeoutMs: 15_000, retries: 1 },
    );

    const columns = parseColumnsFromLlm(result.content ?? '');
    return columns ?? FALLBACK_COLUMNS;
  } catch (err) {
    console.warn(
      '[live-sheet-columns] LLM infer failed:',
      err instanceof Error ? err.message : err,
    );
    return FALLBACK_COLUMNS;
  }
}

export { FALLBACK_COLUMNS as DEFAULT_LIVE_SHEET_COLUMNS };
