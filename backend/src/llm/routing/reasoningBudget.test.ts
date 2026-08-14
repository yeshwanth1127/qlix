import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isReasoningModelId,
  nonReasoningFallbackModel,
  parseReasoningEffort,
  planningMaxTokens,
  resolveReasoning,
  withReasoningHeadroom,
  PLANNING_MIN_MAX_TOKENS,
} from './reasoningBudget.js';

test('parseReasoningEffort accepts catalog values and rejects junk', () => {
  assert.equal(parseReasoningEffort('low'), 'low');
  assert.equal(parseReasoningEffort('HIGH'), 'high');
  assert.equal(parseReasoningEffort('nope'), null);
});

test('static classifier treats deepseek-v4-pro as a reasoning model', () => {
  assert.equal(isReasoningModelId('openrouter/deepseek/deepseek-v4-pro-0813'), true);
  assert.equal(isReasoningModelId('openrouter/openai/gpt-4o-mini'), false);
});

test('planning floor lifts tiny budgets on reasoning models', () => {
  assert.equal(
    planningMaxTokens(1600, 'openrouter/deepseek/deepseek-v4-pro-0813'),
    PLANNING_MIN_MAX_TOKENS,
  );
  assert.equal(planningMaxTokens(1600, 'openrouter/openai/gpt-4o-mini'), 1600);
});

test('headroom only applies to reasoning models', () => {
  const withRoom = withReasoningHeadroom(4096, 'openrouter/deepseek/deepseek-v4-pro-0813');
  assert.ok((withRoom ?? 0) > 4096);
  assert.equal(withReasoningHeadroom(4096, 'openrouter/openai/gpt-4o-mini'), 4096);
});

test('agent purpose keeps reasoning on at low effort when catalog is cold', () => {
  const resolved = resolveReasoning({
    modelId: 'openrouter/deepseek/deepseek-v4-pro-0813',
    purpose: 'agent',
    maxTokens: 4096,
    requestedEffort: 'low',
  });
  // Cold catalog: send nothing (avoid 400s) and grow the budget instead.
  assert.equal(resolved.reasoning, null);
  assert.ok((resolved.maxTokens ?? 0) >= 4096);
});

test('requested none on a reasoning model still grows the budget when catalog is cold', () => {
  const resolved = resolveReasoning({
    modelId: 'openrouter/deepseek/deepseek-v4-pro-0813',
    purpose: 'micro',
    maxTokens: 64,
    requestedEffort: 'none',
  });
  assert.equal(resolved.reasoning, null);
});

test('non-reasoning fallback stays on the same provider family', () => {
  assert.equal(
    nonReasoningFallbackModel('openrouter/deepseek/deepseek-v4-pro-0813'),
    'openrouter/openai/gpt-4o-mini',
  );
  assert.equal(nonReasoningFallbackModel('exora/exora-general'), 'exora/exora-general');
});
