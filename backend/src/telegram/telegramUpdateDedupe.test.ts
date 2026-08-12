import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { _resetTelegramUpdateDedupeForTests, claimTelegramUpdateId } from './telegramUpdateDedupe.js';

describe('claimTelegramUpdateId (memory path)', () => {
  beforeEach(() => {
    _resetTelegramUpdateDedupeForTests();
  });

  it('rejects local duplicates even if DB insert is unavailable', async () => {
    // First call may hit DB; second must be rejected by in-memory map.
    // Use a unique high id unlikely to collide with live traffic in tests.
    const id = 9_000_000_000 + Math.floor(Math.random() * 1_000_000);
    const first = await claimTelegramUpdateId(id);
    const second = await claimTelegramUpdateId(id);
    assert.equal(first, true);
    assert.equal(second, false);
  });
});
