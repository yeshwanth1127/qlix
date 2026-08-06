import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveAutoBillableTier,
  selectInferenceModel,
  tierForModelId,
  TIER_RANK,
} from '../routing/index.js';

describe('Auto routing', () => {
  it('maps gpt-4o-mini to standard and gpt-4o to advanced', () => {
    assert.equal(tierForModelId('openrouter/openai/gpt-4o-mini'), 'standard');
    assert.equal(tierForModelId('openrouter/openai/gpt-4o'), 'advanced');
  });

  it('never sets Auto billable above plan max', () => {
    assert.equal(
      resolveAutoBillableTier({
        requestedModel: 'openrouter/qlix/auto',
        planAllowedTiers: ['economy'],
      }),
      'economy',
    );
    assert.equal(
      resolveAutoBillableTier({
        requestedModel: 'openrouter/qlix/auto',
        planAllowedTiers: ['economy', 'standard', 'advanced'],
      }),
      'standard',
    );
  });

  it('routes Auto to flash-lite on easy prompts within standard ceiling', () => {
    const d = selectInferenceModel({
      requestedModel: 'openrouter/qlix/auto',
      messages: [{ role: 'user', content: 'hi' }],
      planAllowedTiers: ['economy', 'standard'],
      routingEnabled: true,
    });
    assert.equal(d.isAuto, true);
    assert.equal(d.billableTier, 'standard');
    assert.ok(TIER_RANK[d.routingTier] <= TIER_RANK[d.billableTier]);
    assert.equal(d.routedModel, 'openrouter/google/gemini-2.5-flash-lite');
  });

  it('routes Auto to gpt-4o-mini when tools + moderate complexity', () => {
    const d = selectInferenceModel({
      requestedModel: 'openrouter/qlix/auto',
      messages: [
        {
          role: 'user',
          content: 'Explain step by step how to analyze this codebase and compare trade-offs',
        },
      ],
      tools: [{ type: 'function', function: { name: 'search' } }],
      planAllowedTiers: ['economy', 'standard'],
      routingEnabled: true,
    });
    assert.equal(d.routedModel, 'openrouter/openai/gpt-4o-mini');
    assert.ok(TIER_RANK[d.routingTier] <= TIER_RANK.standard);
  });

  it('caps free-plan Auto at economy only', () => {
    const d = selectInferenceModel({
      requestedModel: 'openrouter/qlix/auto',
      messages: [
        {
          role: 'user',
          content: 'Explain step by step how to analyze this and compare trade-offs carefully',
        },
      ],
      tools: [{ type: 'function', function: { name: 'search' } }],
      planAllowedTiers: ['economy'],
      routingEnabled: true,
    });
    assert.equal(d.billableTier, 'economy');
    assert.equal(d.routedModel, 'openrouter/google/gemini-2.5-flash-lite');
  });

  it('leaves pinned models unchanged', () => {
    const d = selectInferenceModel({
      requestedModel: 'openrouter/openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      planAllowedTiers: ['economy', 'standard', 'advanced'],
      routingEnabled: true,
    });
    assert.equal(d.isAuto, false);
    assert.equal(d.routedModel, 'openrouter/openai/gpt-4o');
  });
});
