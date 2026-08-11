import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAutoReplyInboundPrompt,
  jidLocalPart,
  normalizeContactJid,
  normalizeReplyInstructions,
} from './whatsappAutoReply.service.js';

describe('whatsappAutoReply helpers', () => {
  it('normalizes contact jids', () => {
    assert.equal(normalizeContactJid(' 9198@s.whatsapp.net '), '9198@s.whatsapp.net');
  });

  it('extracts local part without device suffix', () => {
    assert.equal(jidLocalPart('919876543210:12@s.whatsapp.net'), '919876543210');
    assert.equal(jidLocalPart('919876543210@lid'), '919876543210');
  });

  it('truncates long reply instructions', () => {
    const long = 'x'.repeat(2500);
    const out = normalizeReplyInstructions(long);
    assert.equal(out?.length, 2000);
  });
});

describe('buildAutoReplyInboundPrompt', () => {
  it('includes stored instructions when present', () => {
    const prompt = buildAutoReplyInboundPrompt({
      label: 'Priya',
      contactJid: '9198@s.whatsapp.net',
      text: 'Sure, 3pm works',
      replyInstructions: 'Book a 30-min call and confirm the time.',
    });
    assert.match(prompt, /WhatsApp reply from Priya/);
    assert.match(prompt, /Sure, 3pm works/);
    assert.match(prompt, /Your instructions for this conversation/);
    assert.match(prompt, /Book a 30-min call/);
  });

  it('falls back to generic guidance without instructions', () => {
    const prompt = buildAutoReplyInboundPrompt({
      label: 'Priya',
      contactJid: '9198@s.whatsapp.net',
      text: 'Hi',
      replyInstructions: null,
    });
    assert.doesNotMatch(prompt, /Your instructions for this conversation/);
    assert.match(prompt, /reply with whatsapp_send_message/);
  });
});
