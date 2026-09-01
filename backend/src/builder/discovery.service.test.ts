import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyRedesignIntent, enforceDiscoveryBoundary, inferMissingOperations, parseDiscoveryPayload } from './discovery.service.js';
import type { DiscoveryOutcome } from './discovery.types.js';

function outcome(overrides: Partial<DiscoveryOutcome> = {}): DiscoveryOutcome {
  return {
    reply: 'Where do leads arrive?',
    operations: [],
    unresolved: [],
    assumptions: [],
    readiness: { score: 0.4, canPlan: false, blocking: ['trigger'] },
    action: 'continue',
    summary: '',
    usage: { inputTokens: 10, cachedInputTokens: null, outputTokens: 20 },
    model: 'openrouter/openai/gpt-4o-mini',
    provider: 'openrouter',
    latencyMs: 12,
    ...overrides,
  };
}

describe('enforceDiscoveryBoundary', () => {
  it('blocks plan on the first user turn even if the model asks to plan', () => {
    const next = enforceDiscoveryBoundary(
      outcome({
        action: 'plan',
        readiness: { score: 0.9, canPlan: true, blocking: [] },
      }),
      1,
    );
    assert.equal(next.action, 'ready');
  });

  it('downgrades plan/ready when readiness is not met', () => {
    const next = enforceDiscoveryBoundary(
      outcome({
        action: 'plan',
        readiness: { score: 0.2, canPlan: false, blocking: ['output'] },
      }),
      4,
    );
    assert.equal(next.action, 'continue');
  });

  it('allows plan after the first turn when readiness is true', () => {
    const next = enforceDiscoveryBoundary(
      outcome({
        action: 'plan',
        readiness: { score: 0.95, canPlan: true, blocking: [] },
      }),
      3,
    );
    assert.equal(next.action, 'plan');
  });
});

describe('applyRedesignIntent', () => {
  it('forces plan when discovery is already ready', () => {
    const next = applyRedesignIntent(
      outcome({
        action: 'ready',
        readiness: { score: 0.9, canPlan: true, blocking: [] },
      }),
    );
    assert.equal(next.action, 'plan');
  });

  it('does not force plan when blockers remain', () => {
    const next = applyRedesignIntent(
      outcome({
        action: 'continue',
        readiness: { score: 0.3, canPlan: false, blocking: ['approval'] },
      }),
    );
    assert.equal(next.action, 'continue');
  });
});

describe('parseDiscoveryPayload', () => {
  it('wraps plain prose when the model ignores structured output', () => {
    const parsed = parseDiscoveryPayload('What criteria should we use to qualify leads?') as {
      reply: string;
      action: string;
    };
    assert.equal(parsed.reply, 'What criteria should we use to qualify leads?');
    assert.equal(parsed.action, 'continue');
  });

  it('parses fenced JSON payloads', () => {
    const parsed = parseDiscoveryPayload(
      '```json\n{"reply":"Ready?","operations":[],"unresolved":[],"assumptions":[],"readiness":{"score":0.8,"canPlan":true,"blocking":[]},"action":"ready","summary":""}\n```',
    ) as { action: string };
    assert.equal(parsed.action, 'ready');
  });
});

describe('inferMissingOperations', () => {
  it('adds lead and whatsapp facts from outreach prompts', () => {
    const ops = inferMissingOperations({
      currentMessage:
        'Filter leads from my Excel list, send WhatsApp messages, collect replies into a new sheet, and send it to me on WhatsApp',
      existingKeys: new Set(),
      operations: [],
    });
    const keys = new Set(ops.map((op) => op.key));
    assert.ok(keys.has('primary_objective'));
    assert.ok(keys.has('input_source'));
    assert.ok(keys.has('notify_channel'));
    assert.ok(keys.has('output_action'));
  });
});
