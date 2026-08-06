import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLocalInbound, ensureGatewayAdapters, getChannelAdapter } from './index.js';
import { buildSessionKeyFromInbound } from './sessionKey.js';

describe('local gateway channel', () => {
  it('registers local adapter', () => {
    ensureGatewayAdapters();
    const adapter = getChannelAdapter('local');
    assert.ok(adapter);
    assert.equal(adapter!.channel, 'local');
  });

  it('buildLocalInbound sets channel=local and preResolved agent route', () => {
    const msg = buildLocalInbound({
      agentId: 'agent-1',
      conversationId: 'conv-1',
      userId: 'user-1',
      orgId: null,
      body: 'hello from terminal',
      agentName: 'My Agent',
    });
    assert.equal(msg.channel, 'local');
    assert.equal(msg.body, 'hello from terminal');
    assert.equal(msg.deliveryTarget.channel, 'local');
    assert.equal(msg.preResolved?.agentId, 'agent-1');
    assert.equal(msg.preResolved?.conversationId, 'conv-1');
    assert.equal(msg.preResolved?.teamRole, null);
    assert.equal(msg.metadata?.channel, 'local');

    const key = buildSessionKeyFromInbound(msg);
    assert.match(key, /channel:local/);
    assert.match(key, /thread:conv-1/);
  });
});
