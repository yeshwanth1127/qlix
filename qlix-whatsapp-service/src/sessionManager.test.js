import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidConnectorId } from './sessionManager.js';

describe('isValidConnectorId', () => {
  it('accepts UUID connector ids', () => {
    assert.equal(isValidConnectorId('4d9adbea-8371-4493-9936-9893432eb516'), true);
  });

  it('rejects junk directory names', () => {
    assert.equal(isValidConnectorId('test'), false);
    assert.equal(isValidConnectorId('debug-qr-test'), false);
    assert.equal(isValidConnectorId(''), false);
  });
});
