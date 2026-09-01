import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyIntentChanges,
  createResolvedTeamIntent,
  effectiveRunGoal,
  isContinueNextActionUserText,
  requirementsFromGoal,
  resolveTeamFollowUpIntent,
} from './teamIntent.js';
import type { TeamRunDTO } from './teams.types.js';

test('atomizes sequential goals without losing compound action details', () => {
  const requirements = requirementsFromGoal(
    'Filter Bangalore leads, then send a greeting, brochure and poll, and then collect replies in Excel',
  );
  assert.equal(requirements.length, 3);
  assert.match(requirements[0]!.text, /Bangalore/);
  assert.match(requirements[1]!.text, /brochure and poll/);
  assert.match(requirements[2]!.text, /Excel/);
});

test('intent patches preserve unrelated requirements', () => {
  const base = requirementsFromGoal('Filter Bangalore leads, then send the brochure');
  const next = applyIntentChanges(base, [
    { operation: 'replace', requirementId: base[0]!.id, text: 'Filter Chennai leads' },
  ]);
  assert.equal(next[0]!.text, 'Filter Chennai leads');
  assert.equal(next[1]!.text, 'send the brochure');
});

test('effective run goal prefers the persisted canonical intent', () => {
  const resolvedIntent = createResolvedTeamIntent({
    userMessage: 'do it again',
    effectiveGoal: 'Filter Bangalore leads, then send the Brain brochure and poll',
    mode: 'repeat',
  });
  const run = {
    id: 'run-2',
    goal: '--- Previous team conversation ---\nFollow-up: do it again',
    resolvedIntent,
  } as TeamRunDTO;
  assert.equal(effectiveRunGoal(run), resolvedIntent.effectiveGoal);
});

test('continue heuristic matches PDF / next-artifact follow-ups', () => {
  assert.equal(isContinueNextActionUserText('create a PDF of that'), true);
  assert.equal(isContinueNextActionUserText('Please make a pdf from the script'), true);
  assert.equal(isContinueNextActionUserText('export this to excel'), true);
  assert.equal(isContinueNextActionUserText('what did you decide about casting?'), false);
});

test('retry-only follow-up resolves to repeat without LLM', async () => {
  const baseIntent = createResolvedTeamIntent({
    userMessage: 'Write an opening scene',
    effectiveGoal: 'Write an opening scene',
    mode: 'new',
  });
  const resolved = await resolveTeamFollowUpIntent({
    userMessage: 'try again',
    baseRunId: 'run-1',
    baseIntent,
    inferenceModel: 'openrouter/openai/gpt-4o',
  });
  assert.equal(resolved.mode, 'repeat');
  assert.equal(resolved.effectiveGoal, 'Write an opening scene');
});

test('PDF follow-up resolves to continue without LLM', async () => {
  const baseIntent = createResolvedTeamIntent({
    userMessage: 'Write an opening scene',
    effectiveGoal: 'Write an opening scene',
    mode: 'new',
  });
  const resolved = await resolveTeamFollowUpIntent({
    userMessage: 'create a PDF of that',
    baseRunId: 'run-1',
    baseIntent,
    inferenceModel: 'openrouter/openai/gpt-4o',
  });
  assert.equal(resolved.mode, 'continue');
  assert.equal(resolved.effectiveGoal, 'create a PDF of that');
});

test('LLM failure defaults to continue instead of throwing', async () => {
  const baseIntent = createResolvedTeamIntent({
    userMessage: 'Write an opening scene',
    effectiveGoal: 'Write an opening scene',
    mode: 'new',
  });
  const resolved = await resolveTeamFollowUpIntent({
    userMessage: 'tighten the dialogue and add stage directions',
    baseRunId: 'run-1',
    baseIntent,
    inferenceModel: 'openrouter/openai/gpt-4o',
    complete: async () => {
      throw new Error('timeout');
    },
  });
  assert.equal(resolved.mode, 'continue');
  assert.equal(resolved.effectiveGoal, 'tighten the dialogue and add stage directions');
});

test('LLM classify uses the caller-supplied user model', async () => {
  let seenModel: string | undefined;
  let seenProvider: string | undefined;
  const baseIntent = createResolvedTeamIntent({
    userMessage: 'Write an opening scene',
    effectiveGoal: 'Write an opening scene',
    mode: 'new',
  });
  const resolved = await resolveTeamFollowUpIntent({
    userMessage: 'add a second act with more conflict',
    baseRunId: 'run-1',
    baseIntent,
    inferenceModel: 'openrouter/anthropic/claude-sonnet-4',
    complete: async (req, opts) => {
      seenModel = req.model;
      seenProvider = opts.provider;
      return {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: '1',
            type: 'function' as const,
            function: {
              name: 'resolve_team_follow_up',
              arguments: JSON.stringify({
                mode: 'continue',
                effectiveGoal: 'add a second act',
                confidence: 0.9,
                requirements: [{ text: 'add a second act' }],
              }),
            },
          },
        ],
      };
    },
  });
  assert.equal(seenModel, 'openrouter/anthropic/claude-sonnet-4');
  assert.equal(seenProvider, 'openrouter');
  assert.equal(resolved.mode, 'continue');
});
