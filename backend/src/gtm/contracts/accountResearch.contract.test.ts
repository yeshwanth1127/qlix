import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountResearchInputSchema,
  accountResearchResultSchema,
  validateAccountResearchEnvelope,
} from './accountResearch.contract.js';

test('account research contracts accept atomic source-backed claims and separate hypotheses', () => {
  assert.equal(accountResearchInputSchema.safeParse({
    schemaVersion: 'gtm.account_research.input.v1',
    campaignId: 'campaign-1',
    accountId: 'account-1',
    candidateDomain: 'example.in',
    sourceSnapshotIds: ['source-1'],
    sourcePolicy: { allowedTiers: ['A', 'B'], maxAgeDays: 730, requireIndependentCorroboration: true },
  }).success, true);

  const result = accountResearchResultSchema.safeParse({
    schemaVersion: 'gtm.account_research.result.v1',
    identity: {
      status: 'resolved', canonicalName: 'Example Engineering Private Limited',
      canonicalDomain: 'example.in', candidateEntities: [], sourceSnapshotIds: ['source-1'],
    },
    claims: [{
      claimId: 'claim-1', predicate: 'operating_location', value: 'Coimbatore',
      timeScope: 'observed 2026-09-01',
      support: [{ sourceSnapshotId: 'source-1', excerpt: 'Our Coimbatore manufacturing facility supports domestic and export orders.', relationship: 'supports' }],
      extractionConfidence: 0.96,
    }],
    hypotheses: [{
      hypothesisId: 'hypothesis-1',
      statement: 'Multi-site production reporting may require manual consolidation.',
      basisClaimIds: ['claim-1'],
      validationQuestions: ['How is production status consolidated across facilities today?'],
    }],
    warnings: [], missingInformation: ['Current ERP system'],
  });
  assert.equal(result.success, true);
});

test('account research result rejects unsupported facts and broken hypothesis lineage', () => {
  const unsupported = accountResearchResultSchema.safeParse({
    schemaVersion: 'gtm.account_research.result.v1',
    identity: {
      status: 'resolved', canonicalName: 'Example Engineering', canonicalDomain: 'example.in',
      candidateEntities: [], sourceSnapshotIds: ['source-1'],
    },
    claims: [{
      claimId: 'claim-1', predicate: 'employee_band', value: '50-200', timeScope: null,
      support: [], extractionConfidence: 0.5,
    }],
    hypotheses: [{
      hypothesisId: 'hypothesis-1', statement: 'The company may have a reconciliation problem.',
      basisClaimIds: ['missing-claim'], validationQuestions: ['How are records reconciled?'],
    }],
    warnings: [], missingInformation: [],
  });
  assert.equal(unsupported.success, false);
});

test('account research envelope rejects source snapshots outside the authorized input set', () => {
  const input = {
    schemaVersion: 'gtm.account_research.input.v1', campaignId: 'campaign-1', accountId: 'account-1',
    candidateDomain: 'example.in', sourceSnapshotIds: ['source-1'],
    sourcePolicy: { allowedTiers: ['A'], maxAgeDays: 365, requireIndependentCorroboration: false },
  };
  const result = {
    schemaVersion: 'gtm.account_research.result.v1',
    identity: {
      status: 'resolved', canonicalName: 'Example Engineering', canonicalDomain: 'example.in',
      candidateEntities: [], sourceSnapshotIds: ['source-1'],
    },
    claims: [{
      claimId: 'claim-1', predicate: 'industry', value: 'Manufacturing', timeScope: null,
      support: [{ sourceSnapshotId: 'source-not-authorized', excerpt: 'Industrial manufacturer.', relationship: 'supports' }],
      extractionConfidence: 0.8,
    }],
    hypotheses: [], warnings: [], missingInformation: [],
  };

  const validation = validateAccountResearchEnvelope(input, result);
  assert.equal(validation.success, false);
  assert.deepEqual(validation.lineageErrors, [
    'Result references unauthorized source snapshot: source-not-authorized.',
  ]);
});
