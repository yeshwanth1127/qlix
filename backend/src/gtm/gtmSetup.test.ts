import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyGtmSetupPatch,
  DEFAULT_GTM_SETUP,
  GtmSetupValidationError,
  normalizeGtmSetup,
} from './gtmSetup.js';

test('GTM setup is discovery-only and derives progress from confirmed setup steps', () => {
  const setup = applyGtmSetupPatch(DEFAULT_GTM_SETUP, {
    companyDescription: 'Governed workflow automation for manufacturers',
    idealCustomerProfile: 'Indian manufacturers with 50–500 employees',
    primaryOffer: 'A paid workflow blueprint followed by a design-partner sprint',
    targetRegions: ['Tamil Nadu', 'Karnataka', 'Tamil Nadu'],
    completedSteps: ['company', 'market', 'offer'],
  });
  assert.equal(setup.operatingMode, 'discovery_only');
  assert.equal(setup.setupStatus, 'in_progress');
  assert.deepEqual(setup.targetRegions, ['Tamil Nadu', 'Karnataka']);

  const calibrating = applyGtmSetupPatch(setup, {
    completedSteps: [...setup.completedSteps, 'validity_policy'],
  });
  assert.equal(calibrating.setupStatus, 'calibrating');

  const ready = applyGtmSetupPatch(calibrating, {
    completedSteps: [...calibrating.completedSteps, 'calibration'],
  });
  assert.equal(ready.setupStatus, 'ready');
  assert.equal(ready.operatingMode, 'discovery_only');
});

test('GTM setup preserves extended foundation fields', () => {
  const setup = applyGtmSetupPatch(DEFAULT_GTM_SETUP, {
    buyerRolesAndWorkflows: 'Plant head and ops manager',
    proofAndCaseStudies: 'Reduced reporting time by 40% at a Tier-1 supplier',
    validityPolicy: 'Tier A sources only for revenue claims',
    calibrationNotes: 'Calibrated against ten Tamil Nadu manufacturers',
    completedSteps: ['buyers', 'proof', 'validity_policy', 'calibration'],
  });
  assert.equal(setup.buyerRolesAndWorkflows.includes('Plant head'), true);
  assert.equal(setup.setupStatus, 'ready');
});

test('GTM setup rejects unknown steps and ignores attempts to persist a broader operating mode', () => {
  assert.throws(
    () => applyGtmSetupPatch(DEFAULT_GTM_SETUP, { completedSteps: ['send_everything'] }),
    GtmSetupValidationError,
  );
  const normalized = normalizeGtmSetup({
    operatingMode: 'bounded_execution',
    setupStatus: 'ready',
    completedSteps: [],
  });
  assert.equal(normalized.operatingMode, 'discovery_only');
  assert.equal(normalized.setupStatus, 'not_started');
});
