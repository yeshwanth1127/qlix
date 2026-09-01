import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertExecutionBudget,
  evaluateBudgetShadow,
  ExecutionBudgetExceededError,
  mapConcurrentOrdered,
  readyNodeIds,
} from './parallelScheduler.js';

test('parallel scheduler preserves deterministic input order', async () => {
  let active = 0;
  let peak = 0;
  const result = await mapConcurrentOrdered([30, 5, 15, 1], 2, async (delay, index) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return `node-${index}`;
  });
  assert.deepEqual(result, ['node-0', 'node-1', 'node-2', 'node-3']);
  assert.equal(peak, 2);
});

test('hierarchical budget reports the exhausted dimension', () => {
  assert.throws(
    () => assertExecutionBudget(
      { promptTokens: 11, completionTokens: 1, inferenceRounds: 2, toolCalls: 1, contextTokens: 5, latencyMs: 20 },
      { maxPromptTokens: 10 },
    ),
    (error) => error instanceof ExecutionBudgetExceededError && error.dimension === 'promptTokens',
  );
});

test('shadow budget records the exhausted dimension without throwing', () => {
  const decision = evaluateBudgetShadow(
    { promptTokens: 11, completionTokens: 1, inferenceRounds: 2, toolCalls: 1, contextTokens: 5, latencyMs: 20 },
    { maxPromptTokens: 10 },
  );
  assert.equal(decision.ok, false);
  assert.equal(decision.dimension, 'promptTokens');
  assert.equal(decision.mode, 'shadow');
});

test('ready-node helper starts independent siblings and waits on joins', () => {
  const nodes = [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: [] },
    { id: 'join', dependsOn: ['a', 'b'] },
  ];
  assert.deepEqual(readyNodeIds(nodes, new Set()), ['a', 'b']);
  assert.deepEqual(readyNodeIds(nodes, new Set(['a'])), ['b']);
  assert.deepEqual(readyNodeIds(nodes, new Set(['a', 'b'])), ['join']);
});

