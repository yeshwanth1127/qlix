import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationPluginRegistry } from './conversationPlugins.js';

test('conversation plugin disposal drains an active action and removes stale registrations', async () => {
  const registry = new ConversationPluginRegistry();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  registry.registerAction({
    name: 'fixture.action',
    validate: () => ({}),
    authorize: async () => undefined,
    execute: async () => { await gate; return { ok: true }; },
  }, { id: 'fixture-owner', kind: 'conversation' });
  const handler = registry.handlers().action!;
  const job = {
    id: 'job-1',
    orgId: 'org-1',
    threadId: 'thread-1',
    kind: 'action',
    idempotencyKey: 'idem-1',
    payload: { action: 'fixture.action', input: {} },
    attemptCount: 1,
  };
  const active = handler(job);
  const disposing = registry.disposeOwner('fixture-owner');
  await Promise.resolve();
  await assert.rejects(handler({ ...job, id: 'job-2' }), /not allowlisted|not accepting/);
  finish();
  assert.deepEqual(await active, { ok: true });
  await disposing;
  await assert.rejects(handler({ ...job, id: 'job-3' }), /not allowlisted/);
});
