import { clip } from '../agentChat/agentMemory.service.js';
import type { TeamRunInput } from './teams.types.js';

export const FOLLOW_UP_NOTE_START = '--- Previous team conversation (main note) ---';
export const FOLLOW_UP_NOTE_END = '--- End previous ---';
export const FOLLOW_UP_LABEL = 'Follow-up:';

const MAX_GOAL_CHARS = 1500;
const MAX_RESULT_CHARS = 1200;
const MAX_NOTE_CHARS = 2500;
const MAX_INJECTION_CHARS = 400;
const MAX_INJECTIONS = 6;

const ATTACHED_FILES_MARKER = '\n\n---\nAttached files';

export interface PriorTeamRunContext {
  goal: string;
  synthesis: string | null;
  errorMessage: string | null;
  userNotes: string[];
}

export function synthesisFromTeamRunResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const synthesis = (result as { synthesis?: unknown }).synthesis;
  return typeof synthesis === 'string' && synthesis.trim() ? synthesis.trim() : null;
}

export function userNotesFromTeamRunEvents(
  events: Array<{ eventType: string; payload: unknown }>,
): string[] {
  const notes: string[] = [];
  for (const event of events) {
    if (event.eventType !== 'user_injection') continue;
    const payload = event.payload as { message?: unknown } | null;
    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    if (!message) continue;
    notes.push(message);
  }
  return notes;
}

export function priorContextFromRun(
  run: { goal: string; result: unknown; errorMessage: string | null },
  events: Array<{ eventType: string; payload: unknown }>,
): PriorTeamRunContext {
  return {
    goal: run.goal,
    synthesis: synthesisFromTeamRunResult(run.result),
    errorMessage: run.errorMessage,
    userNotes: userNotesFromTeamRunEvents(events),
  };
}

const RETRY_ONLY_GOAL_RE =
  /^(try again|do it again|do that again|repeat(?: that| it)?|same again|run it again|retry|again|please retry|re-?run(?: it)?|re-?try|proceed with the original intent)\.?!?$/i;

/** User text that expects an authoritative_input attachment on this run. */
export const GOAL_IMPLIES_ATTACHMENT_RE =
  /\b(attached|uploaded|provided)\s+(spreadsheet|sheet|excel(?:\s+file)?|file|document|workbook)\b/i;

export function goalImpliesAuthoritativeAttachment(goal: string): boolean {
  return GOAL_IMPLIES_ATTACHMENT_RE.test(goal.trim());
}

export function isRetryOnlyUserText(text: string): boolean {
  return RETRY_ONLY_GOAL_RE.test(text.trim());
}

export function intentFromEnvelope(goal: string): string | null {
  const text = goal.trim();
  const startIdx = text.indexOf(FOLLOW_UP_NOTE_START);
  const endIdx = text.indexOf(FOLLOW_UP_NOTE_END);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return null;
  const body = text.slice(startIdx + FOLLOW_UP_NOTE_START.length, endIdx);
  const match = body.match(/^(?:Intent|Goal):\s*(.+)$/m);
  const intent = match?.[1]?.trim() ?? '';
  return intent || null;
}

export function lastResultFromEnvelope(goal: string): string | null {
  const text = goal.trim();
  const startIdx = text.indexOf(FOLLOW_UP_NOTE_START);
  const endIdx = text.indexOf(FOLLOW_UP_NOTE_END);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return null;
  const body = text.slice(startIdx + FOLLOW_UP_NOTE_START.length, endIdx);
  // Result may be multiline JSON — capture until User notes or end of envelope body.
  const header = /^Result:\s*/m.exec(body);
  if (!header || header.index == null) return null;
  const contentStart = header.index + header[0].length;
  const notesIdx = body.indexOf('\nUser notes during that run:', contentStart);
  const contentEnd = notesIdx >= 0 ? notesIdx : body.length;
  const result = body.slice(contentStart, contentEnd).trim();
  return result || null;
}

/** True when synthesis is a blocked/missing-tool failure, not usable source content. */
export function isUnusableTeamSynthesis(text: string | null | undefined): boolean {
  if (!text?.trim()) return true;
  const t = text.trim();
  if (/"status"\s*:\s*"blocked"/i.test(t)) return true;
  if (/needed_to_proceed|required_to_proceed/i.test(t) && /missing|no pdf|no source|scopes:\s*none/i.test(t)) {
    return true;
  }
  if (/Missing source content|no PDF-generation|delegated scopes:\s*none/i.test(t)) return true;
  try {
    const parsed = JSON.parse(t) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && parsed.status === 'blocked') return true;
  } catch {
    // plain text
  }
  return false;
}

/**
 * Prefer a usable prior Result for follow-ups. Walk newest→oldest until we find
 * real content (e.g. the drafted script), skipping blocked PDF failures.
 */
export function pickUsableSynthesis(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const text = typeof candidate === 'string' ? candidate.trim() : '';
    if (text && !isUnusableTeamSynthesis(text)) return text;
  }
  return null;
}

/**
 * Working objective for this run. Retry-only follow-ups ("try again") resolve
 * to the original Intent/Goal in the envelope, not the retry phrase.
 */
export function extractTeamRunUserGoal(goal: string): string {
  const text = goal.trim();
  const startIdx = text.indexOf(FOLLOW_UP_NOTE_START);
  const endIdx = text.indexOf(FOLLOW_UP_NOTE_END);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    return stripAttachedFilesDump(text);
  }
  let rest = text.slice(endIdx + FOLLOW_UP_NOTE_END.length).trim();
  const label = `${FOLLOW_UP_LABEL}`;
  if (rest.toLowerCase().startsWith(label.toLowerCase())) {
    rest = rest.slice(label.length).trim();
  }
  const followUp = stripAttachedFilesDump(rest || text);
  if (isRetryOnlyUserText(followUp)) {
    const intent = intentFromEnvelope(text);
    if (intent && !isRetryOnlyUserText(intent)) return stripAttachedFilesDump(intent);
  }
  return followUp;
}

function stripAttachedFilesDump(goal: string): string {
  const idx = goal.indexOf(ATTACHED_FILES_MARKER);
  if (idx >= 0) {
    const head = goal.slice(0, idx).trim();
    return head || 'Attached files';
  }
  if (goal.startsWith('Attached files (')) {
    return goal.split('\n')[0]?.trim() || goal;
  }
  return goal;
}

export function buildTeamRunFollowUpNote(prior: PriorTeamRunContext): string {
  const intent = clip(extractTeamRunUserGoal(prior.goal), MAX_GOAL_CHARS);
  const resultSource = prior.synthesis?.trim() || prior.errorMessage?.trim() || '';
  const result = resultSource ? clip(resultSource, MAX_RESULT_CHARS) : '';
  const notes = prior.userNotes
    .slice(-MAX_INJECTIONS)
    .map((note) => `- ${clip(extractTeamRunUserGoal(note), MAX_INJECTION_CHARS)}`);

  const lines = [FOLLOW_UP_NOTE_START, `Intent: ${intent || '(none)'}`];
  if (result) lines.push(`Result: ${result}`);
  if (notes.length > 0) {
    lines.push('User notes during that run:');
    lines.push(...notes);
  }
  lines.push(FOLLOW_UP_NOTE_END);

  let note = lines.join('\n');
  if (note.length > MAX_NOTE_CHARS) {
    note = `${clip(note, MAX_NOTE_CHARS)}\n${FOLLOW_UP_NOTE_END}`;
  }
  return note;
}

export function applyTeamRunFollowUp(followUp: string, prior: PriorTeamRunContext): string {
  const userText = followUp.trim() || '(no text)';
  const intent = extractTeamRunUserGoal(prior.goal).trim();
  const body = isRetryOnlyUserText(userText) && intent ? intent : userText;
  return `${buildTeamRunFollowUpNote(prior)}\n\n${FOLLOW_UP_LABEL}\n${body}`;
}

export function resolveContinuedGoal(followUp: string, prior: PriorTeamRunContext | null): string {
  if (!prior) return followUp;
  return applyTeamRunFollowUp(followUp, prior);
}

/** First non-empty inputs walking oldest-to-newest continue hops (nearest ancestor with files). */
export function firstInputsInContinueChain(
  chain: Array<{ inputs?: TeamRunInput[] | null }>,
): TeamRunInput[] {
  for (const run of chain) {
    if (Array.isArray(run.inputs) && run.inputs.length > 0) return run.inputs;
  }
  return [];
}

/** Walk newest→oldest until the original user objective (root run, not a follow-up envelope). */
export function firstRealGoalInContinueChain(chain: Array<{ goal?: string | null }>): string {
  // Prefer the oldest non-envelope goal (the root user ask).
  for (let i = chain.length - 1; i >= 0; i--) {
    const goal = chain[i]?.goal ?? '';
    if (goal.includes(FOLLOW_UP_NOTE_START)) continue;
    const extracted = extractTeamRunUserGoal(goal).trim();
    if (extracted && !isRetryOnlyUserText(extracted)) return extracted;
  }
  // Fall back to Intent: lines from envelopes (oldest first).
  for (let i = chain.length - 1; i >= 0; i--) {
    const intent = intentFromEnvelope(chain[i]?.goal ?? '');
    if (intent && !isRetryOnlyUserText(intent)) return intent;
  }
  for (const run of chain) {
    const extracted = extractTeamRunUserGoal(run.goal ?? '').trim();
    if (extracted && !isRetryOnlyUserText(extracted)) return extracted;
  }
  return extractTeamRunUserGoal(chain[0]?.goal ?? '').trim();
}
