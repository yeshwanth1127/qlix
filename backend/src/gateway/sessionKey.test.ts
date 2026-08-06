import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSessionKey, parseSessionKey } from './sessionKey.js';

describe('buildSessionKey', () => {
  it('builds a stable org|user|channel|peer key', () => {
    const key = buildSessionKey({
      orgId: 'org-1',
      userId: 'user-1',
      channel: 'web',
      peerId: 'user-1',
      threadId: 'conv-1',
    });
    assert.equal(key, 'org:org-1|user:user-1|channel:web|peer:user-1|thread:conv-1');
  });

  it('uses personal when orgId is null', () => {
    const key = buildSessionKey({
      orgId: null,
      userId: 'u',
      channel: 'whatsapp',
      peerId: '+15551234567',
    });
    assert.equal(key, 'org:personal|user:u|channel:whatsapp|peer:+15551234567');
  });

  it('round-trips via parseSessionKey', () => {
    const key = buildSessionKey({
      orgId: 'o',
      userId: 'u',
      channel: 'slack',
      peerId: 'C123',
      threadId: '123.456',
    });
    const parsed = parseSessionKey(key);
    assert.deepEqual(parsed, {
      orgId: 'o',
      userId: 'u',
      channel: 'slack',
      peerId: 'C123',
      threadId: '123.456',
    });
  });
});
