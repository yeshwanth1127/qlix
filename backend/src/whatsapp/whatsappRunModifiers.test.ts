import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWhatsAppRunModifiers,
  resolveUseBrainForWhatsAppRun,
} from './whatsappRunModifiers.js';

describe('parseWhatsAppRunModifiers', () => {
  it('strips #brain and sets flag', () => {
    const r = parseWhatsAppRunModifiers('@local #brain: open the log');
    assert.equal(r.useBrain, true);
    assert.equal(r.text, '@local: open the log');
  });

  it('leaves text unchanged without flags', () => {
    const r = parseWhatsAppRunModifiers('@local: read file');
    assert.equal(r.useBrain, false);
    assert.equal(r.text, '@local: read file');
  });
});

describe('resolveUseBrainForWhatsAppRun', () => {
  it('respects explicit modifier', () => {
    assert.equal(
      resolveUseBrainForWhatsAppRun({
        modifierFlag: true,
        prompt: 'hello',
        permissionScopes: [],
      }),
      true,
    );
  });

  it('auto-enables for policy wording when scope granted', () => {
    assert.equal(
      resolveUseBrainForWhatsAppRun({
        modifierFlag: false,
        prompt: 'follow company policy for log review',
        permissionScopes: ['brain.query', 'system.file_read'],
      }),
      true,
    );
  });
});
