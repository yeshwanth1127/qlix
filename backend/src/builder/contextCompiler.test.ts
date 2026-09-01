import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compileBuilderContext,
  requirementsToPlanningBrief,
  selectContextTier,
  topicSummariesFromFacts,
} from './contextCompiler.js';

describe('builder context compiler', () => {
  it('keeps canonical facts and only a bounded recent window', () => {
    const context = compileBuilderContext({
      phase: 'discovering',
      facts: [{
        key: 'primary_objective',
        category: 'objective',
        value: 'Qualify leads',
        confidence: 0.99,
        sourceMessageId: 'm1',
      }],
      unresolved: [],
      assumptions: [],
      readiness: { score: 0.2, canPlan: false, blocking: ['trigger'] },
      rollingSummary: '',
      recentMessages: Array.from({ length: 20 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        content: `message-${index}`,
        sequence: index + 1,
      })),
      currentMessage: 'They arrive in HubSpot.',
      messageCount: 20,
    });

    assert.match(context, /Qualify leads/);
    assert.match(context, /CONTEXT_TIER: medium/);
    assert.match(context, /TOPIC_SUMMARIES/);
    assert.match(context, /message-19/);
    assert.doesNotMatch(context, /message-0"/);
    assert.match(context, /They arrive in HubSpot/);
  });

  it('uses a short tier for early conversations', () => {
    assert.equal(selectContextTier(4), 'short');
    const context = compileBuilderContext({
      phase: 'discovering',
      facts: [],
      unresolved: [],
      assumptions: [],
      readiness: { score: 0, canPlan: false, blocking: [] },
      rollingSummary: '',
      recentMessages: [
        { role: 'user', content: 'hi', sequence: 1 },
        { role: 'assistant', content: 'hello', sequence: 2 },
      ],
      currentMessage: 'automate lead qualification',
      messageCount: 3,
    });
    assert.match(context, /CONTEXT_TIER: short/);
    assert.doesNotMatch(context, /TOPIC_SUMMARIES/);
  });

  it('builds topic summaries from active facts', () => {
    const topics = topicSummariesFromFacts([
      {
        key: 'primary_objective',
        category: 'objective',
        value: 'Qualify leads',
        confidence: 1,
        sourceMessageId: 'm1',
      },
      {
        key: 'crm',
        category: 'integration',
        value: 'HubSpot',
        confidence: 1,
        sourceMessageId: 'm2',
      },
    ]);
    assert.equal(topics.length, 2);
    assert.equal(topics[0]?.topic, 'integration');
  });

  it('creates a planner brief without the raw transcript', () => {
    const brief = requirementsToPlanningBrief([{
      key: 'source', category: 'input', value: 'HubSpot', confidence: 1, sourceMessageId: 'm2',
    }], 'Qualify new leads', []);
    assert.match(brief, /HubSpot/);
    assert.match(brief, /Qualify new leads/);
  });
});
