import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDeterministicMemoryAnchors } from './agentMemory.service.js';

test('memory anchors retain requirements, decisions, approvals, artifacts, and unfinished work', () => {
  const anchors = buildDeterministicMemoryAnchors([
    { role: 'user', content: 'You must preserve all current agent capabilities.' },
    { role: 'agent', content: 'Decision: use the existing runner contract.' },
    { role: 'user', content: 'Approved. Continue with the remaining upload step.' },
    { role: 'agent', content: 'Created documentId=doc-123456 at https://example.com/doc/123.' },
  ]);
  assert.match(anchors, /preserve all current agent capabilities/);
  assert.match(anchors, /Decision: use the existing runner contract/);
  assert.match(anchors, /Approved/);
  assert.match(anchors, /remaining upload step/);
  assert.match(anchors, /documentId=doc-123456/);
  assert.match(anchors, /https:\/\/example\.com\/doc\/123/);
});
