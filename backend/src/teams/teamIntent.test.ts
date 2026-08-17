import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyIntentChanges,
  createResolvedTeamIntent,
  decideTeamIntent,
  effectiveRunGoal,
  requirementsFromGoal,
  resolveTeamFollowUpIntent,
} from './teamIntent.js';
import type { TeamRunDTO } from './teams.types.js';

test('a mode without a reported confidence is acted on, not questioned', () => {
  const decision = decideTeamIntent({ mode: 'repeat', effectiveGoal: 'Send the brochure' });
  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.mode, 'repeat');
});

test('an explicitly low confidence still asks the user', () => {
  const decision = decideTeamIntent({ mode: 'modify', confidence: 0.2 });
  assert.equal(decision.ok, false);
  assert.match(decision.ok ? '' : decision.reason, /low_confidence/);
});

test('the model can ask its own question', () => {
  const decision = decideTeamIntent({
    mode: 'clarification_required',
    confidence: 0.9,
    clarificationQuestion: 'Should I message the same 40 leads or only the new ones?',
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? '' : decision.question, 'Should I message the same 40 leads or only the new ones?');
});

test('a plain repeat request replays the prior requirements without inference', async () => {
  const baseIntent = createResolvedTeamIntent({
    userMessage: 'Filter Bangalore leads, then send the brochure',
    mode: 'new',
  });
  const resolved = await resolveTeamFollowUpIntent({
    userMessage: 'can u do it again',
    baseRunId: 'run-1',
    baseIntent,
  });
  assert.equal(resolved.mode, 'repeat');
  assert.equal(resolved.baseRunId, 'run-1');
  assert.deepEqual(
    resolved.requirements.map((item) => item.text),
    baseIntent.requirements.map((item) => item.text),
  );
});

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
