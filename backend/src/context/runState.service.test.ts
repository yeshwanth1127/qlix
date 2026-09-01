import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStateOperations, isStatePathAllowed } from './runState.service.js';

test('state set and merge keep nested namespaces intact', () => {
  const namespaces = applyStateOperations(
    { intent: { goal: 'original' }, progress: { stage: 1 } },
    [
      { op: 'set', path: 'intent.goal', value: 'updated' },
      { op: 'merge', path: 'progress', value: { completed: ['security'] } },
    ],
  );
  assert.deepEqual(namespaces, {
    intent: { goal: 'updated' },
    progress: { stage: 1, completed: ['security'] },
  });
});

test('state path grants are prefix-scoped', () => {
  assert.equal(isStatePathAllowed('progress.stage', ['progress']), true);
  assert.equal(isStatePathAllowed('intent.goal', ['progress']), false);
});
