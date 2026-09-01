import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConversationPluginRegistry } from '../conversations/conversationPlugins.js';
import {
  createWhatsAppConversationChannel,
  renderWhatsAppChoice,
} from './whatsappConversationChannel.js';

describe('renderWhatsAppChoice', () => {
  it('maps a generic choice prompt to native poll limits', () => {
    const poll = renderWhatsAppChoice({
      kind: 'choice',
      content: 'Are you interested?',
      options: ['Yes', 'No', 'yes'],
      maxSelections: 1,
    });
    assert.deepEqual(poll, {
      name: 'Are you interested?',
      values: ['Yes', 'No'],
      selectableCount: 1,
    });
  });

  it('rejects more than 12 WhatsApp options', () => {
    assert.throws(
      () =>
        renderWhatsAppChoice({
          kind: 'choice',
          content: 'Pick',
          options: Array.from({ length: 13 }, (_, i) => `o${i}`),
        }),
      /at most 12/,
    );
  });
});

describe('WhatsApp conversation channel adapter', () => {
  it('sends text prompts as messages and choice prompts as polls under contact_send', async () => {
    const texts: string[] = [];
    const polls: Array<{ name: string; values: string[] }> = [];
    const grants: string[] = [];
    const adapter = createWhatsAppConversationChannel({
      sendText: async ({ message }) => {
        texts.push(message);
        return { ok: true };
      },
      sendChoice: async ({ name, values }) => {
        polls.push({ name, values });
        return { ok: true };
      },
      resolveTarget: async () => ({
        connectorId: 'conn-1',
        recipient: '919999999999@s.whatsapp.net',
        agentRunId: 'run-1',
        agentId: 'agent-1',
      }),
      assertSendGrant: async (target) => {
        grants.push(target.agentRunId ?? '');
      },
    });
    const registry = new ConversationPluginRegistry();
    registry.registerChannel(adapter, { id: 'test', kind: 'conversation' });
    const context = { orgId: 'org', threadId: 'thread', idempotencyKey: 'k1' };

    await registry.deliverSend('whatsapp', context, {
      content: 'Hello',
      prompt: { kind: 'text', content: 'Hello' },
    });
    await registry.deliverSend('whatsapp', context, {
      content: 'Are you interested?',
      prompt: { kind: 'choice', content: 'Are you interested?', options: ['Yes', 'No'] },
    });

    assert.deepEqual(texts, ['Hello']);
    assert.deepEqual(polls, [{ name: 'Are you interested?', values: ['Yes', 'No'] }]);
    assert.deepEqual(grants, ['run-1', 'run-1']);
    assert.equal(adapter.sendScope, 'whatsapp.contact_send');
  });
});
