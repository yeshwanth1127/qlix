import assert from 'node:assert/strict';
import test from 'node:test';
import { JIT_MAX_ATTEMPTS, jitAttemptFromPayload, nextJitAttempt } from './jitRetry.js';

test('jit attempts start at 1 and allow 4 more windows', () => {
  assert.equal(JIT_MAX_ATTEMPTS, 5);
  assert.equal(jitAttemptFromPayload({}), 1);
  assert.equal(nextJitAttempt(1), 2);
  assert.equal(nextJitAttempt(4), 5);
  assert.equal(nextJitAttempt(5), null);
});
