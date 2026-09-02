import assert from 'node:assert/strict';
import test from 'node:test';
import { applyGtmSetupPatch, DEFAULT_GTM_SETUP, normalizeGtmSetup } from './gtmSetup.js';
import { buildSetupProposalDiff } from './gtmSetupProposal.service.js';

test('GTM setup proposal diff captures before and after values', () => {
  const current = applyGtmSetupPatch(DEFAULT_GTM_SETUP, {
    companyDescription: 'Old positioning',
    targetRegions: ['Karnataka'],
  });
  const diff = buildSetupProposalDiff(current, {
    companyDescription: 'New positioning',
    targetRegions: ['Tamil Nadu', 'Karnataka'],
  });
  assert.equal(diff.length, 2);
  assert.equal(diff[0].field, 'companyDescription');
  assert.equal(diff[0].before, 'Old positioning');
  assert.equal(diff[0].after, 'New positioning');
});

test('confirmed fields are preserved in normalized setup', () => {
  const setup = normalizeGtmSetup({
    ...DEFAULT_GTM_SETUP,
    confirmedFields: ['companyDescription'],
  });
  assert.deepEqual(setup.confirmedFields, ['companyDescription']);
});
