import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayChannel } from './types.js';
import {
  getChannelAdapter,
  getChannelAdapterMetadata,
  registerChannelAdapter,
} from './pluginSdk.js';

test('gateway adapter registration is owned and disposable', async () => {
  const channel = 'phase11-fixture' as GatewayChannel;
  const handle = registerChannelAdapter(
    { channel, deliver: async () => undefined },
    { owner: { id: 'gateway-fixture', kind: 'gateway' } },
  );
  assert.ok(getChannelAdapter(channel));
  assert.deepEqual(getChannelAdapterMetadata(channel)?.owner, {
    id: 'gateway-fixture',
    kind: 'gateway',
  });
  await handle.dispose();
  assert.equal(getChannelAdapter(channel), undefined);
});
