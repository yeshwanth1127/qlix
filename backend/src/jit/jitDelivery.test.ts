import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  jitEventChannel,
  resolveJitDeliveryChannel,
  shouldDeliverJitToExternalChat,
} from './jitDelivery.js';

describe('resolveJitDeliveryChannel', () => {
  it('uses the stored agent-run source', () => {
    assert.equal(
      resolveJitDeliveryChannel({ sourceChannel: 'api', teamRole: 'whatsapp', teamRunSourceChannel: 'web' }),
      'api',
    );
  });

  it('falls back to legacy teamRole then team-run source', () => {
    assert.equal(resolveJitDeliveryChannel({ teamRole: 'whatsapp' }), 'whatsapp');
    assert.equal(resolveJitDeliveryChannel({ teamRunSourceChannel: 'api' }), 'api');
    assert.equal(resolveJitDeliveryChannel({}), 'web');
  });
});

describe('shouldDeliverJitToExternalChat', () => {
  it('only fans out to the chat the run started from', () => {
    assert.equal(shouldDeliverJitToExternalChat('whatsapp'), true);
    assert.equal(shouldDeliverJitToExternalChat('slack'), true);
    assert.equal(shouldDeliverJitToExternalChat('api'), false);
    assert.equal(shouldDeliverJitToExternalChat('web'), false);
  });
});

describe('jitEventChannel', () => {
  it('labels console-originated waits as dashboard', () => {
    assert.equal(jitEventChannel('web'), 'dashboard');
    assert.equal(jitEventChannel('api'), 'api');
    assert.equal(jitEventChannel('whatsapp'), 'whatsapp');
  });
});
