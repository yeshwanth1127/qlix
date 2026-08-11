import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  _resetTelegramUpdateDedupeForTests,
  claimTelegramUpdateId,
} from './telegramUpdateDedupe.js';

describe('claimTelegramUpdateId', () => {
  beforeEach(() => {
    _resetTelegramUpdateDedupeForTests();
  });

  it('accepts an update once and rejects duplicates', () => {
    assert.equal(claimTelegramUpdateId(42), true);
    assert.equal(claimTelegramUpdateId(42), false);
    assert.equal(claimTelegramUpdateId(43), true);
  });
});
