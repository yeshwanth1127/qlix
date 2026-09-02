import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryProposalSchema, discoveryResolutionState, EVIDENCE_CLASSES, hypothesisEvidenceSchema, hypothesisReviewSchema, HYPOTHESIS_KINDS } from './discoveryFoundation.service.js';
import { GTM_DISCOVERY_BRAIN_TOOL_DEFINITIONS } from '../aiBrain/brainTools.js';

test('idea proposals accept incomplete founder context while requiring the idea', () => {
  const result = discoveryProposalSchema.safeParse({
    kind: 'idea', rationale: 'Start discovery', payload: { idea: 'Reduce production reporting delays' },
  });
  assert.equal(result.success, true);
  if (result.success && result.data.kind === 'idea') assert.equal(result.data.payload.audience, '');
});

test('hypothesis proposals keep evidence class explicit', () => {
  for (const evidenceClass of EVIDENCE_CLASSES) {
    const result = discoveryProposalSchema.safeParse({
      kind: 'hypothesis', rationale: 'Founder review',
      payload: { kind: HYPOTHESIS_KINDS[0], statement: 'Plant managers lose time consolidating reports', evidenceClass },
    });
    assert.equal(result.success, true);
  }
});

test('discovery proposals reject blank ideas and unsupported classes', () => {
  assert.equal(discoveryProposalSchema.safeParse({ kind: 'idea', rationale: 'Review', payload: { idea: '  ' } }).success, false);
  assert.equal(discoveryProposalSchema.safeParse({
    kind: 'hypothesis', rationale: 'Review', payload: { kind: 'guess', statement: 'Something', evidenceClass: 'certain' },
  }).success, false);
});

test('discovery proposal resolution is idempotent but conflicting decisions fail closed', () => {
  assert.equal(discoveryResolutionState('pending', 'confirm'), 'apply');
  assert.equal(discoveryResolutionState('confirmed', 'confirm'), 'replay');
  assert.equal(discoveryResolutionState('rejected', 'reject'), 'replay');
  assert.equal(discoveryResolutionState('confirmed', 'reject'), 'conflict');
});

test('Exa exposes separate reviewed tools for ideas and hypotheses', () => {
  assert.deepEqual(GTM_DISCOVERY_BRAIN_TOOL_DEFINITIONS.map((tool) => tool.function.name), [
    'propose_gtm_idea', 'propose_gtm_hypothesis',
  ]);
});

test('hypothesis learning requires a relationship and a non-empty human-readable note', () => {
  assert.equal(hypothesisEvidenceSchema.safeParse({ evidenceType: 'founder_statement', relationship: 'supports', note: 'Three prior projects showed this pattern.' }).success, true);
  assert.equal(hypothesisEvidenceSchema.safeParse({ evidenceType: 'model_guess', relationship: 'supports', note: '' }).success, false);
  assert.equal(hypothesisReviewSchema.safeParse({ status: 'validated' }).success, true);
  assert.equal(hypothesisReviewSchema.safeParse({ status: 'certain' }).success, false);
});
