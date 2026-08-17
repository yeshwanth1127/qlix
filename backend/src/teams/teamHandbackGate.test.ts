import assert from 'node:assert/strict';
import test from 'node:test';
import { handbackFindings } from './teamOrchestrator.js';
import { isEmptyFindings } from './lunaTeamsHost.js';

// A validated Result is stored as { data, provenance } — reading `findings` off the top
// level instead of `data` would report every stage as empty and abort healthy pipelines.
test('findings are read from the validated { data, provenance } envelope', () => {
  const validated = {
    payload: {
      data: { summary: 's', findings: { leads: [{ name: 'Aarav' }] } },
      provenance: { inputRefs: [], recordRefs: [], knowledgeRefs: [] },
    },
  };
  const found = handbackFindings(validated);
  assert.equal(found.known, true);
  assert.deepEqual(found.value, { leads: [{ name: 'Aarav' }] });
  assert.equal(isEmptyFindings(found.value), false);
});

test('the deck run stage-1 handback reads as known-and-empty', () => {
  const found = handbackFindings({
    payload: {
      data: { summary: 'I was unable to validate the pitch deck', findings: {} },
      provenance: { inputRefs: [], recordRefs: [], knowledgeRefs: [] },
    },
  });
  assert.equal(found.known, true);
  assert.equal(isEmptyFindings(found.value), true);
});

test('an unvalidated flat payload is still read', () => {
  const found = handbackFindings({ payload: { summary: 's', findings: 'text' } });
  assert.equal(found.known, true);
  assert.equal(found.value, 'text');
});

test('unrecognised shapes are not reported as empty', () => {
  // known:false keeps the gate from aborting a run whose handback shape it cannot read.
  for (const payload of [undefined, null, 'a string', ['array'], { summary: 'no findings key' }]) {
    assert.equal(handbackFindings({ payload }).known, false, `${JSON.stringify(payload)}`);
  }
});
