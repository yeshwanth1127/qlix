import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeDeterministicReadiness,
  normalizeDiscoveryOutcome,
} from './discoveryNormalize.js';
import type { DiscoveryOutcome, RequirementFactView } from './discovery.types.js';

function outcome(overrides: Partial<DiscoveryOutcome> = {}): DiscoveryOutcome {
  return {
    reply: 'Is there a specific trigger?',
    operations: [],
    unresolved: [{ key: 'trigger', question: 'Is there a specific trigger?', blocking: false }],
    assumptions: [],
    readiness: { score: 0.4, canPlan: false, blocking: [] },
    action: 'continue',
    summary: '',
    usage: { inputTokens: 1, cachedInputTokens: null, outputTokens: 1 },
    model: 'test',
    provider: 'openrouter',
    latencyMs: 1,
    ...overrides,
  };
}

const emailFacts: RequirementFactView[] = [
  {
    key: 'primary_objective',
    category: 'objective',
    value: 'Handle emails',
    confidence: 0.95,
    sourceMessageId: 'm1',
  },
  {
    key: 'email_actions',
    category: 'output',
    value: 'read and draft replies',
    confidence: 0.95,
    sourceMessageId: 'm2',
  },
  {
    key: 'notify_channel',
    category: 'output',
    value: 'whatsapp',
    confidence: 0.9,
    sourceMessageId: 'm4',
  },
  {
    key: 'input_source',
    category: 'input',
    value: 'email inbox',
    confidence: 0.9,
    sourceMessageId: 'm2',
  },
];

describe('discoveryNormalize', () => {
  it('treats a bare "no" as answering prior open questions and stops repeating them', () => {
    const next = normalizeDiscoveryOutcome({
      outcome: outcome({
        reply: 'Is there a specific trigger or condition under which the agent should draft replies?',
        unresolved: [{
          key: 'trigger',
          question: 'Is there a specific trigger or condition under which the agent should draft replies?',
          blocking: false,
        }],
      }),
      factsAfterOps: emailFacts,
      priorUnresolved: [{
        key: 'trigger',
        question: 'Is there a specific trigger or condition under which the agent should draft replies?',
        blocking: false,
      }],
      priorAssumptions: [],
      currentMessage: 'no',
      lastAssistantReply: 'Is there a specific trigger or condition under which the agent should draft replies, such as certain keywords or sender types?',
      userTurnNumber: 5,
    });

    assert.equal(next.unresolved.length, 0);
    assert.equal(next.readiness.canPlan, true);
    assert.equal(next.action, 'ready');
    assert.match(next.reply, /enough to design/i);
    assert.ok(next.assumptions.some((item) => /trigger|restriction/i.test(item)));
  });

  it('computes readiness from core email facts without a model score', () => {
    const readiness = computeDeterministicReadiness(emailFacts, []);
    assert.equal(readiness.canPlan, true);
    assert.ok(readiness.score >= 0.7);
  });

  it('does not treat "no" to a ready-offer as another discovery probe', () => {
    const next = normalizeDiscoveryOutcome({
      outcome: outcome({
        reply: 'Ready for me to design it?',
        unresolved: [],
        readiness: { score: 0.9, canPlan: true, blocking: [] },
        action: 'ready',
      }),
      factsAfterOps: emailFacts,
      priorUnresolved: [],
      priorAssumptions: [],
      currentMessage: 'no',
      lastAssistantReply: 'Ready for me to design it?',
      userTurnNumber: 4,
    });
    assert.equal(next.action, 'ready');
    assert.match(next.reply, /say when/i);
  });
});
