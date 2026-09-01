import {
  chatCompletion,
  LLM_APPLICATION_IDS,
} from '../llm/inferenceRouter.js';
import { llmProviderFromModelId } from '../llm/modelPolicy.js';
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

const FOLLOW_UP_TOOL_NAME = 'resolve_team_follow_up';

const FOLLOW_UP_TOOL = {
  type: 'function' as const,
  function: {
    name: FOLLOW_UP_TOOL_NAME,
    description: 'Classify a completed-run follow-up before the team executes.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: [
            'new',
            'repeat',
            'modify',
            'continue',
            'question',
            'cancel',
            'clarification_required',
          ],
        },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              operation: { type: 'string', enum: ['add', 'remove', 'replace'] },
              requirementId: { type: 'string' },
              text: { type: 'string' },
            },
            required: ['operation'],
          },
        },
        requirements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              text: { type: 'string' },
            },
            required: ['text'],
          },
        },
        effectiveGoal: { type: 'string' },
        confidence: { type: 'number' },
        clarificationQuestion: { type: 'string' },
      },
      required: ['mode', 'effectiveGoal', 'confidence'],
    },
  },
};

/**
 * Short next-action follow-ups that clearly build on a prior result
 * (export/PDF/convert/send of "that") — skip the LLM.
 */
export function isContinueNextActionUserText(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 280) return false;
  if (
    /\b(create|make|export|convert|generate|produce|render|save|write)\b[\s\S]{0,60}\b(pdf|document|docx?|pptx?|spreadsheet|excel|csv|file|brochure|report)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(pdf|document|docx?|pptx?|spreadsheet|excel|csv)\b[\s\S]{0,40}\b(of|from|for)\s+(that|it|this|the)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /^(please\s+)?(also\s+)?(now\s+)?(create|make|export|convert|send|email|download)\b/i.test(t) &&
    t.length < 140
  ) {
    return true;
  }
  return false;
}

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

function continueFromUserMessage(
  userMessage: string,
  baseRunId: string,
): ResolvedTeamIntent {
  return createResolvedTeamIntent({
    userMessage,
    effectiveGoal: userMessage,
    mode: 'continue',
    baseRunId,
    requirements: requirementsFromGoal(userMessage, 'follow_up'),
    confidence: 1,
  });
}

function parseFollowUpPayload(result: {
  content: string;
  toolCalls?: Array<{ function: { name: string; arguments: string } }> | null;
}): Record<string, unknown> {
  const call = result.toolCalls?.find((c) => c.function.name === FOLLOW_UP_TOOL_NAME);
  if (call) {
    return JSON.parse(call.function.arguments) as Record<string, unknown>;
  }
  return JSON.parse(stripCodeFence(result.content)) as Record<string, unknown>;
}

export class TeamIntentClarificationRequiredError extends Error {
  readonly code = 'team_intent_clarification_required';
  readonly status = 409;
}

/** Resolve a completed-run follow-up before any plan or external action exists. */
export async function resolveTeamFollowUpIntent(input: {
  userMessage: string;
  baseRunId: string;
  baseIntent: ResolvedTeamIntent;
  previousResult?: string | null;
  /** User/team model for this conversation — required for LLM classify. */
  inferenceModel?: string | null;
  /** Test seam; production uses inferenceRouter.chatCompletion. */
  complete?: typeof chatCompletion;
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

  if (isContinueNextActionUserText(userMessage)) {
    return continueFromUserMessage(userMessage, input.baseRunId);
  }

  const model = input.inferenceModel?.trim();
  if (!model) {
    console.warn(
      `[team-intent] no inferenceModel for follow-up baseRun=${input.baseRunId}; defaulting to continue`,
    );
    return continueFromUserMessage(userMessage, input.baseRunId);
  }

  const provider = llmProviderFromModelId(model);
  const complete = input.complete ?? chatCompletion;
  let result: Awaited<ReturnType<typeof chatCompletion>>;
  try {
    result = await complete(
      {
        model,
        messages: [
          {
            role: 'system',
            content: `You resolve a follow-up for an agent-team workflow before execution.
Call ${FOLLOW_UP_TOOL_NAME} with the classification.
Rules:
- repeat means run every prior requirement again.
- modify means preserve every prior requirement except explicit add/remove/replace operations.
- continue means perform a new next action using the prior result; do not replay completed external actions.
- Producing a new artifact from the prior result (PDF, export, email, convert, download) is continue — not clarification.
- question means answer from prior context without external writes.
- cancel means do not perform external actions.
- clarification_required when the requested change is ambiguous or contradictory; include clarificationQuestion.
- Never silently omit a prior requirement in modify mode.
- For modify mode, return patch operations against the supplied stable IDs.`,
          },
          {
            role: 'user',
            content: [
              `Previous effective goal: ${input.baseIntent.effectiveGoal}`,
              `Previous requirements:\n${input.baseIntent.requirements.map((r) => `- ${r.id}: ${r.text}`).join('\n')}`,
              input.previousResult
                ? `Previous validated result:\n${input.previousResult.slice(0, 1600)}`
                : null,
              `Latest user message: ${userMessage}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        temperature: 0,
        max_tokens: 900,
        stream: false,
        reasoning_purpose: 'micro',
        tools: [FOLLOW_UP_TOOL],
        tool_choice: { type: 'function', function: { name: FOLLOW_UP_TOOL_NAME } },
      },
      {
        provider,
        applicationId: LLM_APPLICATION_IDS.lunaTeams,
        timeoutMs: 20_000,
        retries: 1,
      },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(
      `[team-intent] LLM failed for follow-up baseRun=${input.baseRunId} model=${model}: ${detail}; defaulting to continue`,
    );
    return continueFromUserMessage(userMessage, input.baseRunId);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseFollowUpPayload(result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(
      `[team-intent] bad follow-up payload baseRun=${input.baseRunId}: ${detail}; defaulting to continue`,
    );
    return continueFromUserMessage(userMessage, input.baseRunId);
  }

  const mode = INTENT_MODES.has(parsed.mode as TeamIntentMode)
    ? (parsed.mode as TeamIntentMode)
    : 'clarification_required';
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  const clarificationQuestion = cleanText(parsed.clarificationQuestion);

  if (mode === 'clarification_required' || confidence < 0.65) {
    if (isContinueNextActionUserText(userMessage)) {
      return continueFromUserMessage(userMessage, input.baseRunId);
    }
    if (clarificationQuestion) {
      throw new TeamIntentClarificationRequiredError(clarificationQuestion);
    }
    console.warn(
      `[team-intent] low-confidence follow-up without question baseRun=${input.baseRunId}; defaulting to continue`,
    );
    return continueFromUserMessage(userMessage, input.baseRunId);
  }

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
      throw new TeamIntentClarificationRequiredError(
        'The requested change did not match a known part of the previous workflow.',
      );
    }
    const requirements = applyIntentChanges(input.baseIntent.requirements, changes);
    if (requirements.length === 0 || changes.length === 0) {
      throw new TeamIntentClarificationRequiredError(
        'Please specify exactly which part of the previous workflow should change.',
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
    requirements:
      rawRequirements.length > 0
        ? rawRequirements
        : requirementsFromGoal(effectiveGoal, 'follow_up'),
    changes,
    confidence,
  });
}
