import assert from 'node:assert/strict';
import test from 'node:test';

import { isCompatibleCompletionReplay } from './actions.service.js';

test('accepts a replay of the same successful terminal outcome', () => {
  assert.equal(isCompatibleCompletionReplay({ phase: 'complete', success: true }, true), true);
});

test('accepts a replay of the same failed terminal outcome', () => {
  assert.equal(isCompatibleCompletionReplay({ phase: 'complete', success: false }, false), true);
});

test('rejects a contradictory terminal outcome', () => {
  assert.equal(isCompatibleCompletionReplay({ phase: 'complete', success: false }, true), false);
  assert.equal(isCompatibleCompletionReplay({ phase: 'complete', success: true }, false), false);
});

test('rejects malformed legacy completion payloads', () => {
  assert.equal(isCompatibleCompletionReplay(null, true), false);
  assert.equal(isCompatibleCompletionReplay({ phase: 'complete' }, true), false);
});
