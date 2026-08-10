import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ScheduleValidationError,
  computeNextRunAt,
  validateCronExpression,
} from './schedule.service.js';

describe('validateCronExpression', () => {
  it('accepts 5-field UTC cron', () => {
    validateCronExpression('0 9 * * 1-5');
  });

  it('rejects non-5-field expressions', () => {
    assert.throws(() => validateCronExpression('0 9 * *'), (err: unknown) => {
      return err instanceof ScheduleValidationError;
    });
  });
});

describe('computeNextRunAt', () => {
  it('returns a future minute for cron', () => {
    const from = new Date('2026-08-10T08:00:00.000Z');
    const next = computeNextRunAt({
      scheduleType: 'cron',
      cronExpression: '0 9 * * 1-5',
      from,
    });
    assert.ok(next);
    assert.ok(next!.getTime() > from.getTime());
    assert.equal(next!.getUTCHours(), 9);
    assert.equal(next!.getUTCMinutes(), 0);
  });

  it('returns onceAt when still in the future', () => {
    const from = new Date('2026-08-10T08:00:00.000Z');
    const onceAt = new Date('2026-08-10T12:00:00.000Z');
    const next = computeNextRunAt({ scheduleType: 'once', onceAt, from });
    assert.equal(next?.toISOString(), onceAt.toISOString());
  });

  it('returns null for onceAt in the past', () => {
    const from = new Date('2026-08-10T12:00:00.000Z');
    const onceAt = new Date('2026-08-10T08:00:00.000Z');
    const next = computeNextRunAt({ scheduleType: 'once', onceAt, from });
    assert.equal(next, null);
  });

  it('adds intervalSeconds for interval schedules', () => {
    const from = new Date('2026-08-10T08:00:00.000Z');
    const next = computeNextRunAt({
      scheduleType: 'interval',
      intervalSeconds: 300,
      from,
    });
    assert.equal(next?.getTime(), from.getTime() + 300_000);
  });
});
