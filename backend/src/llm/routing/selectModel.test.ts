import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OPENROUTER_FREE_ROUTER,
  resolveAutoBillableTier,
  selectInferenceModel,
  tierForModelId,
  TIER_RANK,
  buildDecisionBrief,
  buildDecisionBriefFromMessages,
  classifyHandoffError,
  simulateCascadeSavings,
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

  it('cascade scout routes easy Auto prompts to openrouter/free', () => {
    const d = selectInferenceModel({
      requestedModel: 'openrouter/qlix/auto',
      messages: [{ role: 'user', content: 'hi' }],
      planAllowedTiers: ['economy', 'standard'],
      routingEnabled: true,
    });
    assert.equal(d.isAuto, true);
    assert.equal(d.routedModel, OPENROUTER_FREE_ROUTER);
    assert.equal(d.cascadePhase, 'scout');
    assert.equal(d.reason, 'cascade_scout');
  });

  it('cascade keeps tool gathering on free scout', () => {
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
    assert.equal(d.routedModel, OPENROUTER_FREE_ROUTER);
    assert.equal(d.cascadePhase, 'scout');
  });

  it('cascade escalates to paid on synthesis round', () => {
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
      cascade: { synthesisRound: true },
    });
    assert.equal(d.cascadePhase, 'paid');
    assert.equal(d.routedModel, 'openrouter/openai/gpt-4o-mini');
  });

  it('cascade escalates on force paid phase', () => {
    const d = selectInferenceModel({
      requestedModel: 'openrouter/qlix/auto',
      messages: [{ role: 'user', content: 'hi' }],
      planAllowedTiers: ['economy', 'standard'],
      routingEnabled: true,
      cascade: { phase: 'paid', escalateReason: 'forced' },
    });
    assert.equal(d.cascadePhase, 'paid');
    assert.ok(d.routedModel.includes('gemini') || d.routedModel.includes('gpt-4o-mini'));
  });

  it('caps free-plan Auto paid escalate at economy flash-lite', () => {
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
      cascade: { phase: 'paid', synthesisRound: true },
    });
    assert.equal(d.billableTier, 'economy');
    assert.equal(d.routedModel, 'openrouter/google/gemini-2.5-flash-lite');
  });

  it('routes Exora Auto to the gateway alias without free router', () => {
    const d = selectInferenceModel({
      requestedModel: 'exora/qlix/auto',
      messages: [{ role: 'user', content: 'Summarize this request' }],
      planAllowedTiers: ['economy', 'standard'],
      routingEnabled: true,
    });
    assert.equal(d.isAuto, true);
    assert.equal(d.routedModel, 'exora/exora-general');
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

describe('cascade helpers', () => {
  it('builds a decision brief under budget', () => {
    const brief = buildDecisionBrief({
      goal: 'Fill the form',
      facts: ['Name is Ada', 'Email is ada@example.com'],
      artifacts: ['https://example.com/form'],
    });
    assert.match(brief, /Decision Brief/);
    assert.match(brief, /Fill the form/);
    assert.match(brief, /Ada/);
  });

  it('builds brief from tool messages', () => {
    const brief = buildDecisionBriefFromMessages([
      { role: 'user', content: 'Task:\nBook a demo' },
      { role: 'tool', content: 'Found slot https://cal.example/x at 3pm' },
    ]);
    assert.match(brief, /Book a demo/);
    assert.match(brief, /https:\/\/cal\.example\/x/);
  });

  it('classifies rate limits for handoff', () => {
    const h = classifyHandoffError({ statusCode: 429, message: 'Too Many Requests' });
    assert.equal(h.handoff, true);
    assert.equal(h.mode, 'same_history');
    assert.equal(h.reason, 'rate_limited');
  });

  it('simulates token and cost reduction vs baseline flash pricing', () => {
    const sim = simulateCascadeSavings([
      {
        promptTokens: 18868,
        completionTokens: 224,
        totalTokens: 19092,
        totalCostUsd: 0,
        model: 'openrouter/stealth/ox-alpha',
      },
      {
        promptTokens: 129764,
        completionTokens: 6439,
        totalTokens: 136203,
        totalCostUsd: 0,
        model: 'openrouter/stealth/ox-alpha',
      },
      {
        promptTokens: 10497,
        completionTokens: 1015,
        totalTokens: 11512,
        totalCostUsd: 0.00180915,
        model: 'openrouter/openai/gpt-4o-mini',
      },
    ]);
    assert.equal(sim.runCount, 3);
    assert.ok(sim.baselineUsd > sim.cascadeUsd);
    assert.ok(sim.usdSavedPct > 50);
    assert.ok(sim.tokensBillableSavedPct > 50);
    assert.ok(sim.scoutTokenShare >= 0.5);
  });
});
