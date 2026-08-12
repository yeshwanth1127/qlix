import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRemoteJidMuted, isValidConnectorId } from './sessionManager.js';

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

describe('isRemoteJidMuted', () => {
  it('matches muted phone JIDs and LID mappings', () => {
    const entry = {
      lidToPn: new Map([['198874266390689@lid', '918105199337@s.whatsapp.net']]),
      pnToLid: new Map([['918105199337@s.whatsapp.net', '198874266390689@lid']]),
    };
    const muted = new Set(['918105199337@s.whatsapp.net']);
    assert.equal(isRemoteJidMuted(entry, '918105199337@s.whatsapp.net', muted), true);
    assert.equal(isRemoteJidMuted(entry, '198874266390689@lid', muted), true);
    assert.equal(isRemoteJidMuted(entry, '919999999999@s.whatsapp.net', muted), false);
  });

  it('is false when the mute set is empty', () => {
    assert.equal(isRemoteJidMuted({ lidToPn: new Map() }, '918105199337@s.whatsapp.net', new Set()), false);
  });
});
