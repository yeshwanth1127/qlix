import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoReplyInferenceOverride,
  autoReplyOwnerFailureNotice,
  resolveWhatsAppRunDelivery,
} from './whatsappDeliveryPolicy.js';

describe('resolveWhatsAppRunDelivery', () => {
  it('sends ordinary WhatsApp channel runs to self-chat', () => {
    assert.equal(
      resolveWhatsAppRunDelivery({ success: true }),
      'self',
    );
    assert.equal(
      resolveWhatsAppRunDelivery({ success: false }),
      'self',
    );
  });

  it('never dumps a failed auto-reply into the contact chat', () => {
    assert.equal(
      resolveWhatsAppRunDelivery({
        replyToJid: '918105199337@s.whatsapp.net',
        success: false,
      }),
      'self',
    );
  });

  it('skips contact dump when the agent already sent via tool', () => {
    assert.equal(
      resolveWhatsAppRunDelivery({
        replyToJid: '918105199337@s.whatsapp.net',
        success: true,
        alreadySentToContact: true,
      }),
      'none',
    );
  });

  it('falls back to contact dump when the agent returned text only', () => {
    assert.equal(
      resolveWhatsAppRunDelivery({
        replyToJid: '918105199337@s.whatsapp.net',
        success: true,
        alreadySentToContact: false,
      }),
      'contact',
    );
  });
});

describe('autoReplyOwnerFailureNotice', () => {
  it('omits raw HTTP status from the owner notice', () => {
    const notice = autoReplyOwnerFailureNotice({
      agentName: 'WhatsApp Messenger',
      contactJid: '918105199337@s.whatsapp.net',
    });
    assert.match(notice.title, /WhatsApp Messenger/);
    assert.match(notice.body, /918105199337/);
    assert.doesNotMatch(notice.body, /502|HTTP/i);
  });
});

describe('autoReplyInferenceOverride', () => {
  it('pins Exora agents onto OpenRouter for contact auto-reply', () => {
    assert.equal(
      autoReplyInferenceOverride({ llmProvider: 'exora', llmModel: 'exora/exora-general' }),
      'openrouter/openai/gpt-4o-mini',
    );
  });

  it('leaves OpenRouter agents on their own model', () => {
    assert.equal(
      autoReplyInferenceOverride({
        llmProvider: 'openrouter',
        llmModel: 'openrouter/openai/gpt-4o',
      }),
      null,
    );
  });
});
