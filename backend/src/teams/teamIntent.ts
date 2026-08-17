import { isLlmProviderConfigured, LLM_APPLICATION_IDS } from '../llm/inferenceRouter.js';
import { completeStructured } from '../wait/structuredCompletion.js';
import type {
  ResolvedTeamIntent,
  TeamIntentChange,
  TeamIntentMode,
  TeamIntentRequirement,
  TeamRunDTO,
} from './teams.types.js';
import { extractTeamRunUserGoal, isRetryOnlyUserText } from './teamRunFollowUp.js';

const INTENT_MODES = new Set<TeamIntentMode>([
  'new',
  'repeat',
  'modify',
  'continue',
  'question',
  'cancel',
  'clarification_required',
]);

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function requirementId(text: string, index: number): string {
  const slug = text
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
  return `req_${index + 1}_${slug || 'outcome'}`;
}

/** Conservative, domain-neutral atomization used without an extra LLM call. */
export function requirementsFromGoal(
  goal: string,
  source: TeamIntentRequirement['source'] = 'original',
): TeamIntentRequirement[] {
  const normalized = goal.trim().replace(/\s+/g, ' ');
  if (!normalized) return [];
  const clauses = normalized
    .split(/(?:\s*(?:\n+|;+)\s*|\s*,?\s+and\s+then\s+|\s*,?\s+then\s+)/i)
    .map((part) => part.replace(/^[,.:\-\s]+|[,.:\-\s]+$/g, '').trim())
    .filter(Boolean);
  const values = clauses.length > 0 ? clauses : [normalized];
  return values.map((text, index) => ({ id: requirementId(text, index), text, source }));
}

export function createResolvedTeamIntent(input: {
  userMessage: string;
  effectiveGoal?: string;
  mode?: TeamIntentMode;
  baseRunId?: string;
  requirements?: TeamIntentRequirement[];
  changes?: TeamIntentChange[];
  confidence?: number;
  clarificationQuestion?: string;
}): ResolvedTeamIntent {
  const effectiveGoal = cleanText(input.effectiveGoal ?? input.userMessage);
  return {
    version: 1,
    mode: input.mode ?? 'new',
    userMessage: input.userMessage.trim(),
    effectiveGoal,
    ...(input.baseRunId ? { baseRunId: input.baseRunId } : {}),
    requirements:
      input.requirements?.filter((item) => item.id.trim() && item.text.trim()) ??
      requirementsFromGoal(effectiveGoal),
    ...(input.changes?.length ? { changes: input.changes } : {}),
    confidence: Math.max(0, Math.min(1, input.confidence ?? 1)),
    ...(input.clarificationQuestion
      ? { clarificationQuestion: input.clarificationQuestion.trim() }
      : {}),
  };
}

export function isResolvedTeamIntent(value: unknown): value is ResolvedTeamIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<ResolvedTeamIntent>;
  return (
    record.version === 1 &&
    typeof record.mode === 'string' &&
    INTENT_MODES.has(record.mode as TeamIntentMode) &&
    typeof record.effectiveGoal === 'string' &&
    Array.isArray(record.requirements) &&
    record.requirements.every(
      (item) => item && typeof item.id === 'string' && typeof item.text === 'string',
    )
  );
}

export function resolvedIntentForRun(
  run: Pick<TeamRunDTO, 'id' | 'goal' | 'resolvedIntent'>,
): ResolvedTeamIntent {
  if (isResolvedTeamIntent(run.resolvedIntent)) return run.resolvedIntent;
  const effectiveGoal = extractTeamRunUserGoal(run.goal) || run.goal;
  return createResolvedTeamIntent({
    userMessage: effectiveGoal,
    effectiveGoal,
    mode: 'new',
    baseRunId: run.id,
  });
}

export function effectiveRunGoal(
  run: Pick<TeamRunDTO, 'id' | 'goal' | 'resolvedIntent'>,
): string {
  return resolvedIntentForRun(run).effectiveGoal || extractTeamRunUserGoal(run.goal) || run.goal;
}

function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function normalizeChanges(value: unknown): TeamIntentChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): TeamIntentChange[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const operation = record.operation;
    if (operation !== 'add' && operation !== 'remove' && operation !== 'replace') return [];
    const id = cleanText(record.requirementId);
    const text = cleanText(record.text);
    return [{
      operation,
      ...(id ? { requirementId: id } : {}),
      ...(text ? { text } : {}),
    }];
  });
}

export function applyIntentChanges(
  base: TeamIntentRequirement[],
  changes: TeamIntentChange[],
): TeamIntentRequirement[] {
  const next = base.map((item) => ({ ...item }));
  for (const change of changes) {
    if (change.operation === 'add') {
      const text = cleanText(change.text);
      if (!text) continue;
      const id = change.requirementId?.trim() || requirementId(text, next.length);
      if (!next.some((item) => item.id === id)) next.push({ id, text, source: 'follow_up' });
      continue;
    }
    const index = next.findIndex((item) => item.id === change.requirementId);
    if (index < 0) continue;
    if (change.operation === 'remove') {
      next.splice(index, 1);
    } else {
      const text = cleanText(change.text);
      if (text) next[index] = { ...next[index]!, text, source: 'follow_up' };
    }
  }
  return next;
}

function renderRequirementGoal(requirements: TeamIntentRequirement[]): string {
  return requirements.map((item) => item.text.replace(/[.]+$/g, '')).join('. Then ');
}

export class TeamIntentClarificationRequiredError extends Error {
  readonly code = 'team_intent_clarification_required';
  readonly status = 409;
  /** Run the clarification was recorded against, so the chat can show it in place. */
  runId?: string;
  eventId?: string;
}

/**
 * Below this the classifier is telling us it guessed. Only applied when the model
 * actually reports a number — a missing field means "not reported", not "no confidence".
 */
const INTENT_CONFIDENCE_FLOOR = 0.65;

export type TeamIntentDecision =
  | { ok: true; mode: TeamIntentMode; confidence: number }
  | { ok: false; reason: string; question: string };

/**
 * Whether the classifier's answer is safe to act on.
 *
 * `confidence` is advisory: models routinely answer a clear "do it again" without it, and
 * treating that absence as zero turned every terse-but-certain follow-up into a dead-end
 * question. Only a number the model actually reported can block execution.
 */
export function decideTeamIntent(parsed: Record<string, unknown>): TeamIntentDecision {
  const mode = INTENT_MODES.has(parsed.mode as TeamIntentMode)
    ? (parsed.mode as TeamIntentMode)
    : 'clarification_required';
  const reported =
    typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence))
      : null;
  const question =
    cleanText(parsed.clarificationQuestion) ||
    'Please clarify whether to repeat, modify, or continue the previous workflow.';

  if (mode === 'clarification_required') {
    return { ok: false, reason: 'model_requested', question };
  }
  if (reported !== null && reported < INTENT_CONFIDENCE_FLOOR) {
    return { ok: false, reason: `low_confidence:${String(reported)}`, question };
  }
  return { ok: true, mode, confidence: reported ?? 1 };
}

function clarificationRequired(
  reason: string,
  message: string,
  context: { baseRunId: string; userMessage: string },
): TeamIntentClarificationRequiredError {
  console.warn(
    `[team-intent] clarification required run=${context.baseRunId} reason=${reason} ` +
      `message=${JSON.stringify(context.userMessage.slice(0, 200))}`,
  );
  return new TeamIntentClarificationRequiredError(message);
}

/** Resolve a completed-run follow-up before any plan or external action exists. */
export async function resolveTeamFollowUpIntent(input: {
  userMessage: string;
  baseRunId: string;
  baseIntent: ResolvedTeamIntent;
  previousResult?: string | null;
  /** Question we asked the user last turn, so their answer is read as the reply to it. */
  pendingClarification?: string | null;
}): Promise<ResolvedTeamIntent> {
  const userMessage = input.userMessage.trim();
  if (isRetryOnlyUserText(userMessage)) {
    return createResolvedTeamIntent({
      userMessage,
      effectiveGoal: input.baseIntent.effectiveGoal,
      mode: 'repeat',
      baseRunId: input.baseRunId,
      requirements: input.baseIntent.requirements.map((item) => ({ ...item })),
      confidence: 1,
    });
  }

  const content = await completeStructured({
    label: 'team-intent',
    applicationId: LLM_APPLICATION_IDS.lunaTeams,
    // Naming the model keeps this on a provider that answers a short JSON prompt quickly;
    // the router otherwise rewrites it onto the default provider, where a timeout plus
    // fallback made the user wait ~45s just to be asked a question. Without an OpenRouter
    // key, fall through to whatever the workspace default is.
    model: isLlmProviderConfigured('openrouter') ? 'openrouter/openai/gpt-4o-mini' : null,
    temperature: 0,
    maxTokens: 900,
    timeoutMs: 20_000,
    system: `You resolve a follow-up for an agent-team workflow before execution.
Return one JSON object only: {"mode":"new|repeat|modify|continue|question|cancel|clarification_required","changes":[{"operation":"add|remove|replace","requirementId":"existing id when applicable","text":"new requirement text when applicable"}],"requirements":[{"id":"stable id","text":"atomic active requirement"}],"effectiveGoal":"concise complete goal","confidence":<number 0-1: how sure you are of the mode, NOT a fixed value>,"clarificationQuestion":"optional"}.
Rules:
- repeat means run every prior requirement again. A plain "do it again" style request is repeat with high confidence.
- modify means preserve every prior requirement except explicit add/remove/replace operations.
- continue means perform a new next action using the prior result; do not replay completed external actions.
- question means answer from prior context without external writes.
- cancel means do not perform external actions.
- clarification_required only when the request is genuinely ambiguous or contradictory, never as a default.
- Never silently omit a prior requirement in modify mode.
- For modify mode, return patch operations against the supplied stable IDs.`,
    user: [
      `Previous effective goal: ${input.baseIntent.effectiveGoal}`,
      `Previous requirements:\n${input.baseIntent.requirements.map((r) => `- ${r.id}: ${r.text}`).join('\n')}`,
      input.previousResult ? `Previous validated result:\n${input.previousResult.slice(0, 1600)}` : null,
      input.pendingClarification
        ? `You already asked the user: ${input.pendingClarification}\nThe message below is their answer to that question.`
        : null,
      `Latest user message: ${userMessage}`,
    ].filter(Boolean).join('\n\n'),
  });
  if (!content) {
    throw clarificationRequired(
      'inference_unavailable',
      'I could not safely resolve this follow-up. Please restate the complete intended workflow.',
      { baseRunId: input.baseRunId, userMessage },
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripCodeFence(content)) as Record<string, unknown>;
  } catch {
    throw clarificationRequired(
      'unparseable_response',
      'I could not safely determine how this follow-up should change the previous workflow.',
      { baseRunId: input.baseRunId, userMessage },
    );
  }
  const decision = decideTeamIntent(parsed);
  if (!decision.ok) {
    throw clarificationRequired(decision.reason, decision.question, {
      baseRunId: input.baseRunId,
      userMessage,
    });
  }
  const { mode, confidence } = decision;

  const changes = normalizeChanges(parsed.changes);
  if (mode === 'repeat') {
    return createResolvedTeamIntent({
      userMessage,
      effectiveGoal: input.baseIntent.effectiveGoal,
      mode,
      baseRunId: input.baseRunId,
      requirements: input.baseIntent.requirements.map((item) => ({ ...item })),
      confidence,
    });
  }
  if (mode === 'modify') {
    const baseIds = new Set(input.baseIntent.requirements.map((item) => item.id));
    const invalidChange = changes.find(
      (change) =>
        change.operation !== 'add' &&
        (!change.requirementId || !baseIds.has(change.requirementId)),
    );
    if (invalidChange) {
      throw clarificationRequired(
        'unknown_requirement_id',
        'The requested change did not match a known part of the previous workflow.',
        { baseRunId: input.baseRunId, userMessage },
      );
    }
    const requirements = applyIntentChanges(input.baseIntent.requirements, changes);
    if (requirements.length === 0 || changes.length === 0) {
      throw clarificationRequired(
        'empty_modify_patch',
        'Please specify exactly which part of the previous workflow should change.',
        { baseRunId: input.baseRunId, userMessage },
      );
    }
    return createResolvedTeamIntent({
      userMessage,
      effectiveGoal: renderRequirementGoal(requirements),
      mode,
      baseRunId: input.baseRunId,
      requirements,
      changes,
      confidence,
    });
  }

  const rawRequirements = Array.isArray(parsed.requirements)
    ? parsed.requirements.flatMap((item, index): TeamIntentRequirement[] => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const text = cleanText(record.text);
        if (!text) return [];
        const id = cleanText(record.id) || requirementId(text, index);
        return [{ id, text, source: 'follow_up' }];
      })
    : [];
  const effectiveGoal = cleanText(parsed.effectiveGoal) || userMessage;
  return createResolvedTeamIntent({
    userMessage,
    effectiveGoal,
    mode,
    baseRunId: input.baseRunId,
    requirements: rawRequirements.length > 0
      ? rawRequirements
      : requirementsFromGoal(effectiveGoal, 'follow_up'),
    changes,
    confidence,
  });
}
