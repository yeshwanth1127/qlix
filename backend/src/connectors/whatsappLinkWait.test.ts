import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isWhatsAppLinkReady,
  waitForWhatsAppLinkPoll,
} from './whatsappLinkWait.js';

describe('waitForWhatsAppLinkPoll', () => {
  it('returns immediately when QR is present', async () => {
    let calls = 0;
    const result = await waitForWhatsAppLinkPoll(async () => {
      calls += 1;
      return { qr: 'qr-data', status: 'pending_qr' };
    });
    assert.equal(result.qr, 'qr-data');
    assert.equal(calls, 1);
  });

  it('polls until QR appears', async () => {
    let calls = 0;
    const result = await waitForWhatsAppLinkPoll(
      async () => {
        calls += 1;
        return calls >= 3
          ? { qr: 'late-qr', status: 'pending_qr' }
          : { qr: null, status: 'pending_qr' };
      },
      { intervalMs: 10, maxMs: 500 },
    );
    assert.equal(result.qr, 'late-qr');
    assert.ok(calls >= 3);
  });

  it('returns last status when deadline passes without QR', async () => {
    const result = await waitForWhatsAppLinkPoll(
      async () => ({ qr: null, status: 'pending_qr' }),
      { intervalMs: 5, maxMs: 25 },
    );
    assert.equal(result.qr, null);
    assert.equal(result.status, 'pending_qr');
  });
});

describe('isWhatsAppLinkReady', () => {
  it('accepts QR or connected', () => {
    assert.equal(isWhatsAppLinkReady({ qr: 'x', status: 'pending_qr' }), true);
    assert.equal(isWhatsAppLinkReady({ qr: null, status: 'connected' }), true);
    assert.equal(isWhatsAppLinkReady({ qr: null, status: 'pending_qr' }), false);
  });
});
