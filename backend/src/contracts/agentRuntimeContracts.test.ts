import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  decodeNestedJsonValue,
  parseCapabilityDescriptor,
  parseRunnerRequest,
  parseRunnerResponse,
  parseRuntimeEventEnvelope,
  unwrapRunnerRequest,
  unwrapRunnerResponse,
  wrapLegacyRunnerRequest,
  wrapLegacyRunnerResponse,
  ContractVersionError,
  RUNNER_REQUEST_CONTRACT_VERSION,
  negotiateContractVersion,
} from './agentRuntimeContracts.js';

test('nested runner JSON decoding is bounded and preserves plain text', () => {
  const result = { summary: 'done', provenance: { inputRefs: [] } };
  assert.deepEqual(decodeNestedJsonValue(JSON.stringify(result)), result);
  assert.deepEqual(decodeNestedJsonValue(JSON.stringify(JSON.stringify(result))), result);
  assert.equal(decodeNestedJsonValue('ordinary agent reply'), 'ordinary agent reply');
  assert.equal(decodeNestedJsonValue('{malformed'), '{malformed');
});

const fixtureUrl = new URL('../../../contracts/agent-runtime/fixtures/capability-descriptor.v1.json', import.meta.url);
const eventFixtureUrl = new URL('../../../contracts/agent-runtime/fixtures/runtime-event.v1.json', import.meta.url);
const requestFixtureUrl = new URL('../../../contracts/agent-runtime/fixtures/runner-request.v1.json', import.meta.url);
const responseFixtureUrl = new URL('../../../contracts/agent-runtime/fixtures/runner-response.v1.json', import.meta.url);

test('TypeScript accepts the shared capability descriptor fixture', () => {
  const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown;
  assert.deepEqual(parseCapabilityDescriptor(fixture), fixture);
});

test('TypeScript rejects an unknown capability descriptor version', () => {
  const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as Record<string, unknown>;
  fixture.contractVersion = 'qlix.capability.v999';
  assert.throws(() => parseCapabilityDescriptor(fixture));
});

test('TypeScript accepts the shared runtime event fixture', () => {
  const fixture = JSON.parse(readFileSync(eventFixtureUrl, 'utf8')) as unknown;
  assert.deepEqual(parseRuntimeEventEnvelope(fixture), fixture);
});

test('TypeScript rejects an unknown runtime event version', () => {
  const fixture = JSON.parse(readFileSync(eventFixtureUrl, 'utf8')) as Record<string, unknown>;
  fixture.contractVersion = 'qlix.runtime-event.v999';
  assert.throws(() => parseRuntimeEventEnvelope(fixture));
});

test('TypeScript accepts both shared runner fixtures', () => {
  const request = JSON.parse(readFileSync(requestFixtureUrl, 'utf8')) as unknown;
  const response = JSON.parse(readFileSync(responseFixtureUrl, 'utf8')) as unknown;
  assert.deepEqual(parseRunnerRequest(request), request);
  assert.deepEqual(parseRunnerResponse(response), response);
});

test('TypeScript legacy runner adapters preserve every payload field', () => {
  const request = JSON.parse(readFileSync(requestFixtureUrl, 'utf8')) as ReturnType<typeof parseRunnerRequest>;
  const response = JSON.parse(readFileSync(responseFixtureUrl, 'utf8')) as ReturnType<typeof parseRunnerResponse>;
  const wrappedRequest = wrapLegacyRunnerRequest({ agentId: request.agentId, runtime: request.runtime, payload: request.payload });
  assert.deepEqual(unwrapRunnerRequest(wrappedRequest), request.payload);
  const legacyResponse = unwrapRunnerResponse(response);
  assert.deepEqual(unwrapRunnerResponse(wrapLegacyRunnerResponse(response.runId, legacyResponse)), legacyResponse);
});

test('contract negotiation preserves legacy mode and rejects incompatibility', () => {
  assert.equal(negotiateContractVersion(undefined, [RUNNER_REQUEST_CONTRACT_VERSION]), undefined);
  assert.equal(
    negotiateContractVersion(['future.v2', RUNNER_REQUEST_CONTRACT_VERSION], [RUNNER_REQUEST_CONTRACT_VERSION]),
    RUNNER_REQUEST_CONTRACT_VERSION,
  );
  assert.throws(
    () => negotiateContractVersion(['future.v2'], [RUNNER_REQUEST_CONTRACT_VERSION]),
    ContractVersionError,
  );
});
