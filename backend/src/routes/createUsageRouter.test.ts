import assert from 'node:assert/strict';
import test from 'node:test';
import { extractUsageEventDetails, resolveUsageProvider } from './createUsageRouter.js';

test('usage provider falls back to the canonical model prefix', () => {
  assert.equal(resolveUsageProvider(null, 'openrouter/stealth/ox-alpha'), 'openrouter');
  assert.equal(resolveUsageProvider('exora', 'openrouter/vendor/model'), 'exora');
  assert.equal(resolveUsageProvider(null, 'vendor/model'), null);
});

test('usage event details expose cached tokens, provider cost, and each round', () => {
  const details = extractUsageEventDetails([
    {
      seq: 3,
      data: {
        message: 'context_size_round',
        round: 2,
        estimatedInputTokens: 8000,
        messageTokens: 6800,
        toolsSchemaTokens: 1200,
        retainedToolChars: 9000,
      },
    },
    {
      seq: 1,
      data: {
        message: 'inference_success',
        usage: {
          prompt_tokens_details: { cached_tokens: 4096 },
          cost_details: { upstream_inference_cost: 0.012345 },
        },
      },
    },
    {
      seq: 2,
      data: {
        message: 'context_size',
        rounds: 2,
        peakRequestTokens: 8000,
        estimatedInputTokens: 14000,
        toolsSchemaTokens: 1200,
      },
    },
  ]);

  assert.equal(details.cachedPromptTokens, 4096);
  assert.equal(details.upstreamInferenceCostUsd, 0.012345);
  assert.equal(details.roundCount, 2);
  assert.equal(details.peakRequestTokens, 8000);
  assert.equal(details.estimatedInputTokens, 14000);
  assert.deepEqual(details.rounds, [
    {
      round: 2,
      estimatedInputTokens: 8000,
      messageTokens: 6800,
      toolsSchemaTokens: 1200,
      retainedToolChars: 9000,
    },
  ]);
});

test('usage event details expose context-pack component attribution', () => {
  const details = extractUsageEventDetails([
    {
      seq: 1,
      data: {
        message: 'context_pack',
        components: { memory: 400, task: 120 },
      },
    },
    {
      seq: 2,
      data: {
        message: 'context_size_round',
        round: 1,
        estimatedInputTokens: 1720,
        messageTokens: 520,
        toolsSchemaTokens: 1200,
        retainedToolChars: 0,
        components: { memory: 400, task: 120, tools: 1200 },
      },
    },
  ]);
  assert.deepEqual(details.components, { memory: 400, task: 120 });
  assert.deepEqual(details.rounds[0]?.components, { memory: 400, task: 120, tools: 1200 });
});
