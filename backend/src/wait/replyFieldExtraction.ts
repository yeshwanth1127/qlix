/**
 * Pull goal-specific values (city, degree, experience, …) out of an inbound reply.
 *
 * The wait system fills the five contact/reply fields itself. Every other column on a live
 * artifact is free-form and only the reply text knows what belongs in it, so those cells are
 * extracted here. Channel-agnostic: it sees column names and message text, nothing else.
 */
import { LLM_APPLICATION_IDS } from '../llm/inferenceRouter.js';
import { completeStructured } from './structuredCompletion.js';

export type ExtractedReplyFields = Record<string, string | null>;

const MAX_TEXT_CHARS = 800;
const MAX_GOAL_CHARS = 400;
const MAX_VALUE_CHARS = 120;

function cleanValue(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Models like to answer "not mentioned" rather than emitting null.
  if (/^(null|none|n\/?a|unknown|not\s+(?:mentioned|provided|specified|stated|given))$/i.test(trimmed)) {
    return null;
  }
  return trimmed.slice(0, MAX_VALUE_CHARS);
}

/** Exported for tests: turn a model response into values for the requested columns. */
export function parseExtractedFields(raw: string, columns: string[]): ExtractedReplyFields {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const byKey = new Map<string, string>();
  for (const column of columns) {
    byKey.set(column.trim().toLowerCase().replace(/[^a-z0-9]+/g, ''), column);
  }

  const out: ExtractedReplyFields = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const column = byKey.get(key.trim().toLowerCase().replace(/[^a-z0-9]+/g, ''));
    if (!column) continue;
    const cleaned = cleanValue(value);
    if (cleaned !== null) out[column] = cleaned;
  }
  return out;
}

/**
 * Ask the model which of `columns` this reply answers. Returns only the values it found —
 * absent keys mean "still unknown", so callers keep whatever they already had.
 */
export async function extractReplyFields(input: {
  columns: string[];
  text: string;
  goal?: string | null;
  /** Values already captured for this contact, so the model can skip what is settled. */
  known?: Record<string, string | null>;
  /** Model the surrounding run is routed to. */
  model?: string | null;
}): Promise<ExtractedReplyFields> {
  const columns = input.columns.filter((column) => column.trim().length > 0);
  const text = String(input.text ?? '').trim();
  if (columns.length === 0 || !text) return {};

  // Only ask about columns that are still blank.
  const pending = columns.filter((column) => !input.known?.[column]);
  if (pending.length === 0) return {};

  const goalSnippet = (input.goal ?? '').trim().slice(0, MAX_GOAL_CHARS);

  const content = await completeStructured({
    label: 'reply-field-extraction',
    applicationId: LLM_APPLICATION_IDS.nlBuilder,
    model: input.model,
    temperature: 0,
    maxTokens: 200,
    timeoutMs: 12_000,
    system:
      'You extract structured details from a single inbound message.\n' +
      `Return ONLY a JSON object whose keys are exactly these fields: ${JSON.stringify(pending)}.\n` +
      'Each value must be a short string taken from the message, or null when the message ' +
      'does not state it. Never guess, never infer from context, never repeat the question ' +
      'back. Copy values as the sender wrote them, lightly tidied (e.g. "bangalore" -> ' +
      '"Bangalore").' +
      (goalSnippet ? `\nOutreach context: ${goalSnippet}` : ''),
    user: text.slice(0, MAX_TEXT_CHARS),
  });

  return parseExtractedFields(content, pending);
}
