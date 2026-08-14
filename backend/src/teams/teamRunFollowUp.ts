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
  const match = body.match(/^Result:\s*(.+)$/m);
  return match?.[1]?.trim() || null;
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

/** Walk newest→oldest follow-ups until the original user objective (not "try again"). */
export function firstRealGoalInContinueChain(chain: Array<{ goal?: string | null }>): string {
  for (const run of chain) {
    const extracted = extractTeamRunUserGoal(run.goal ?? '').trim();
    if (extracted && !isRetryOnlyUserText(extracted)) return extracted;
  }
  return extractTeamRunUserGoal(chain[0]?.goal ?? '').trim();
}
