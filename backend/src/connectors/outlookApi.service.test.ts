import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { outlookCreateDraft, outlookList, outlookSend } from './outlookApi.service.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('outlookApi.service', () => {
  it('maps Graph messages into the email read result shape', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      value: [{
        id: 'message-1', conversationId: 'thread-1', subject: 'Hello', bodyPreview: 'Preview',
        receivedDateTime: '2026-08-11T00:00:00.000Z',
        from: { emailAddress: { address: 'alice@example.com' } },
        toRecipients: [{ emailAddress: { address: 'bob@example.com' } }],
        body: { contentType: 'html', content: '<p>Hello <b>Bob</b></p>' },
      }],
    }), { status: 200 })) as typeof fetch;

    const result = await outlookList({ accessToken: 'token', query: '', maxResults: 10 });
    assert.deepEqual(result.messages[0], {
      id: 'message-1', threadId: 'thread-1', from: 'alice@example.com', to: ['bob@example.com'],
      subject: 'Hello', snippet: 'Preview', bodyText: 'Hello Bob', receivedAt: '2026-08-11T00:00:00.000Z',
    });
  });

  it('uses Graph draft and send endpoints', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body as string | undefined });
      if (String(input).endsWith('/messages')) {
        return new Response(JSON.stringify({ id: 'draft-1', conversationId: 'thread-1' }), { status: 201 });
      }
      return new Response('', { status: 202 });
    }) as typeof fetch;

    const draft = await outlookCreateDraft({
      accessToken: 'token', to: ['bob@example.com'], subject: 'Hello', bodyText: 'Body',
    });
    const sent = await outlookSend({
      accessToken: 'token', to: ['bob@example.com'], subject: 'Hello', bodyText: 'Body',
    });

    assert.equal(draft.draftId, 'draft-1');
    assert.equal(sent.status, 'sent');
    assert.ok(calls[0].url.endsWith('/messages'));
    assert.ok(calls[1].url.endsWith('/sendMail'));
  });
});
