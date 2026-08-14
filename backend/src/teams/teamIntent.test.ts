import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyIntentChanges,
  createResolvedTeamIntent,
  effectiveRunGoal,
  requirementsFromGoal,
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
