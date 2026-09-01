import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mergeRunTimeline, redactTimelineValue } from './runTimeline.service.js';
import { attachTrace, createTraceEnvelope, readTraceEnvelope, traceLinks } from '../contracts/traceEnvelope.js';

test('timeline merge is chronological and deterministic', () => {
  const items = mergeRunTimeline([
    { id: 'b', at: '2026-01-01T00:00:02.000Z', source: 'run_event', kind: 'tool', links: {}, data: {} },
    { id: 'a', at: '2026-01-01T00:00:01.000Z', source: 'message', kind: 'input', links: {}, data: {} },
    { id: 'c', at: '2026-01-01T00:00:02.000Z', source: 'action', kind: 'start', links: {}, data: {} },
  ]);
  assert.deepEqual(items.map((item) => item.id), ['a', 'c', 'b']);
});

test('diagnostic timeline removes credentials and hidden reasoning', () => {
  const redacted = redactTimelineValue({
    authorization: 'Bearer abc',
    output: 'token=supersecret usable text',
    reasoning: 'private chain',
    nested: { apiKey: 'key-value' },
  }) as Record<string, unknown>;
  assert.equal(redacted.authorization, '[REDACTED]');
  assert.equal(redacted.output, 'token=[REDACTED] usable text');
  assert.equal('reasoning' in redacted, false);
  assert.deepEqual(redacted.nested, { apiKey: '[REDACTED]' });
});

test('individual and Team replay fixtures use stable linked IDs', () => {
  for (const name of ['individual_run.json', 'team_run.json']) {
    const fixture = JSON.parse(
      readFileSync(new URL(`../../../contracts/replay/${name}`, import.meta.url), 'utf8'),
    ) as { run: Record<string, string>; expectedOrder: string[]; privacy: Record<string, string> };
    assert.ok(fixture.run.runId);
    assert.ok(fixture.run.agentId);
    assert.ok(fixture.run.conversationId);
    assert.ok(fixture.expectedOrder.length >= 8);
    assert.equal(fixture.privacy.hiddenReasoning, 'excluded');
  }
});

test('run timeline links include the shared tracing envelope', () => {
  const envelope = createTraceEnvelope({
    traceId: 'team_1',
    spanId: 'run:run_1:4',
    parentSpanId: 'team_1',
    executionId: 'run_1',
    executionKind: 'agent_run',
    agentId: 'agent_1',
  });
  const stamped = attachTrace({ message: 'context_size_round', round: 1 }, envelope);
  const links = {
    runId: 'run_1',
    ...traceLinks(readTraceEnvelope(stamped)!),
  };
  assert.equal(links.traceId, 'team_1');
  assert.equal(links.spanId, 'run:run_1:4');
  assert.equal(links.executionKind, 'agent_run');
  assert.equal(links.parentSpanId, 'team_1');
});
