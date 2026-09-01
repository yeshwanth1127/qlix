import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  attachTrace,
  childTraceEnvelope,
  createTraceEnvelope,
  parseTraceEnvelope,
  TRACE_ENVELOPE_CONTRACT_VERSION,
  traceLinks,
} from './traceEnvelope.js';

const fixtureUrl = new URL('../../../contracts/telemetry/fixtures/trace-envelope.v1.json', import.meta.url);

test('shared trace envelope fixture is valid', () => {
  const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown;
  const parsed = parseTraceEnvelope(fixture);
  assert.equal(parsed.contractVersion, TRACE_ENVELOPE_CONTRACT_VERSION);
  assert.equal(parsed.executionKind, 'agent_run');
  assert.equal(traceLinks(parsed).traceId, 'team_run_example_1');
});

test('child spans keep the parent trace and never invent a new tenant', () => {
  const parent = createTraceEnvelope({
    traceId: 'team_1',
    spanId: 'team_1',
    executionId: 'team_1',
    executionKind: 'team_run',
    orgId: 'org_1',
    agentId: 'lead_1',
  });
  const child = childTraceEnvelope(parent, {
    spanId: 'run:worker_1:0',
    executionId: 'worker_1',
    executionKind: 'agent_run',
    agentId: 'worker_1',
  });
  assert.equal(child.traceId, 'team_1');
  assert.equal(child.parentSpanId, 'team_1');
  assert.equal(child.orgId, 'org_1');
  assert.equal(child.executionKind, 'agent_run');
});

test('attachTrace does not overwrite an existing envelope', () => {
  const first = createTraceEnvelope({
    traceId: 'run_1',
    spanId: 'run:run_1:0',
    executionId: 'run_1',
    executionKind: 'agent_run',
  });
  const second = createTraceEnvelope({
    traceId: 'other',
    spanId: 'other',
    executionId: 'run_1',
    executionKind: 'gateway',
  });
  const stamped = attachTrace({ message: 'tool', trace: first }, second) as { trace: { traceId: string } };
  assert.equal(stamped.trace.traceId, 'run_1');
});
