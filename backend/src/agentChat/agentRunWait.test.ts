import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAgentRunWaitSlice } from './agentRunService.js';

test('JIT pending time does not consume the agent-run timeout', () => {
  const paused = applyAgentRunWaitSlice({
    sliceMs: 180_000,
    activeMs: 5_000,
    timeoutMs: 180_000,
    holdingForJit: false,
    jitPending: true,
  });
  assert.equal(paused.activeMs, 0);
  assert.equal(paused.holdingForJit, true);
  assert.equal(paused.timedOut, false);
});

test('after JIT resolves, work gets a fresh timeout window', () => {
  const resumed = applyAgentRunWaitSlice({
    sliceMs: 500,
    activeMs: 0,
    timeoutMs: 180_000,
    holdingForJit: true,
    jitPending: false,
  });
  assert.equal(resumed.activeMs, 500);
  assert.equal(resumed.holdingForJit, false);
  assert.equal(resumed.timedOut, false);
});

test('active work time still times out when no JIT is pending', () => {
  const waited = applyAgentRunWaitSlice({
    sliceMs: 10_000,
    activeMs: 175_000,
    timeoutMs: 180_000,
    holdingForJit: false,
    jitPending: false,
  });
  assert.equal(waited.activeMs, 185_000);
  assert.equal(waited.timedOut, true);
});

test('asks for a JIT check when the work timeout is about to elapse', () => {
  const check = applyAgentRunWaitSlice({
    sliceMs: 10_000,
    activeMs: 175_000,
    timeoutMs: 180_000,
    holdingForJit: false,
  });
  assert.equal(check.needsJitCheck, true);
  assert.equal(check.timedOut, false);
});
