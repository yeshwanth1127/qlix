import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampWaitTtlHours,
  isTeamWaitReadyToResume,
  WAIT_TTL_CUSTOM_MAX_HOURS,
  WAIT_TTL_CUSTOM_MIN_HOURS,
} from './waitTrigger.service.js';

describe('isTeamWaitReadyToResume', () => {
  it('stays paused while any contact wait is still open', () => {
    assert.equal(isTeamWaitReadyToResume({ remaining: 1, total: 2 }), false);
    assert.equal(isTeamWaitReadyToResume({ remaining: 2, total: 2 }), false);
  });

  it('is ready when every contact wait is closed', () => {
    assert.equal(isTeamWaitReadyToResume({ remaining: 0, total: 2 }), true);
    assert.equal(isTeamWaitReadyToResume({ remaining: 0, total: 1 }), true);
  });

  it('is not ready with an empty wait set', () => {
    assert.equal(isTeamWaitReadyToResume({ remaining: 0, total: 0 }), false);
  });
});

describe('clampWaitTtlHours', () => {
  it('accepts preset and custom values inside the safety cap', () => {
    assert.equal(clampWaitTtlHours(1), 1);
    assert.equal(clampWaitTtlHours(24), 24);
    assert.equal(clampWaitTtlHours(0.25), WAIT_TTL_CUSTOM_MIN_HOURS);
    assert.equal(clampWaitTtlHours(168), WAIT_TTL_CUSTOM_MAX_HOURS);
  });

  it('rejects out-of-range values', () => {
    assert.throws(() => clampWaitTtlHours(0), /between/);
    assert.throws(() => clampWaitTtlHours(200), /between/);
    assert.throws(() => clampWaitTtlHours(Number.NaN), /number/);
  });
});
