import { LLM_APPLICATION_IDS } from '../llm/inferenceRouter.js';
import { completeStructured } from './structuredCompletion.js';

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

const MAX_COLUMNS = 12;

/**
 * Columns the LLM invented for goal-specific details (city, degree, experience, …) — anything
 * that is not one of the five contact/reply fields the wait system fills in on its own.
 */
export function customLiveSheetColumns(columns: string[]): string[] {
  return columns.filter((column) => !column.startsWith('_') && !resolveLiveSheetField(column));
}

function dedupeColumns(columns: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const column of columns) {
    const key = column.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(column);
  }
  return out;
}

function parseColumnsFromLlm(raw: string): string[] | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return null;
    const columns = dedupeColumns(
      parsed
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ).slice(0, MAX_COLUMNS);
    if (columns.length < 3) return null;
    const fields = new Set(columns.map((col) => resolveLiveSheetField(col)).filter(Boolean));
    if (!fields.has('reply')) return null;
    return columns;
  } catch {
    return null;
  }
}

/** Ask the LLM for human-friendly sheet headers based on the user's goal. */
export async function inferLiveSheetColumnsFromGoal(
  goal: string,
  model?: string | null,
): Promise<string[]> {
  const snippet = goal.trim().slice(0, 1200);
  if (!snippet) return FALLBACK_COLUMNS;

  const content = await completeStructured({
    label: 'live-sheet-columns',
    applicationId: LLM_APPLICATION_IDS.nlBuilder,
    model,
    temperature: 0.2,
    maxTokens: 200,
    system:
      'You pick spreadsheet column headers for a live reply tracker. ' +
      `Return ONLY a JSON array of 4–${MAX_COLUMNS} short header strings (no markdown). ` +
      'Start with five columns covering who replied, their number, what they said, how ' +
      'interested they sound, and when they replied. Give those natural short labels that fit ' +
      'the goal, like ["Lead name", "Mobile", "Response", "Interest", "Replied at"] — never ' +
      'echo this description back as a header. ' +
      'Then add one extra column for each specific detail the goal says to collect from the ' +
      'contact during the conversation — for example city, degree, years of experience, or ' +
      'which follow-up they picked. Name those columns after the detail itself ("City", ' +
      '"Degree", "Experience"), one detail per column, and add none if the goal asks for no ' +
      'extra details. Do NOT include JID or internal IDs.',
    user: `User goal:\n${snippet}`,
  });

  return parseColumnsFromLlm(content) ?? FALLBACK_COLUMNS;
}

export { FALLBACK_COLUMNS as DEFAULT_LIVE_SHEET_COLUMNS };
