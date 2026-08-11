import type { EmailReadResult, EmailSendResult } from './connectors.types.js';

const GRAPH_MAIL_BASE = 'https://graph.microsoft.com/v1.0/me';

export class OutlookApiError extends Error {
  readonly code = 'outlook_api_failed';
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

async function graphFetch(accessToken: string, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${GRAPH_MAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    const message = ((body.error as { message?: string } | undefined)?.message ?? text).slice(0, 500);
    throw new OutlookApiError(`Microsoft Graph ${response.status}: ${message}`, response.status);
  }
  return body;
}

type GraphMessage = {
  id?: string; conversationId?: string; subject?: string; bodyPreview?: string; receivedDateTime?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  body?: { content?: string; contentType?: string };
  hasAttachments?: boolean;
};
export type OutlookAttachmentMeta = {
  attachmentId: string; fileName: string; mimeType: string; sizeBytes: number;
};
export type OutlookFetchedMessage = EmailReadResult['messages'][number] & {
  _attachmentMetas?: OutlookAttachmentMeta[];
};

function stripHtml(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function mapMessage(message: GraphMessage): OutlookFetchedMessage {
  const body = message.body?.content ?? '';
  return {
    id: message.id ?? '',
    threadId: message.conversationId ?? '',
    from: message.from?.emailAddress?.address ?? '',
    to: (message.toRecipients ?? []).map((recipient) => recipient.emailAddress?.address ?? '').filter(Boolean),
    subject: message.subject ?? '',
    snippet: message.bodyPreview ?? '',
    bodyText: message.body?.contentType?.toLowerCase() === 'html' ? stripHtml(body) : body,
    receivedAt: message.receivedDateTime ?? new Date().toISOString(),
  };
}

async function outlookAttachments(accessToken: string, messageId: string): Promise<OutlookAttachmentMeta[]> {
  const result = await graphFetch(accessToken, `/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`);
  const rows = Array.isArray(result.value)
    ? result.value as Array<{ id?: string; name?: string; contentType?: string; size?: number; isInline?: boolean }>
    : [];
  return rows
    .filter((item) => item.id && item.name && !item.isInline)
    .map((item) => ({
      attachmentId: item.id!,
      fileName: item.name!.slice(0, 255),
      mimeType: (item.contentType || 'application/octet-stream').slice(0, 200),
      sizeBytes: typeof item.size === 'number' ? item.size : 0,
    }));
}

export async function outlookList(params: {
  accessToken: string; query: string; maxResults: number; messageId?: string | null;
}): Promise<{ messages: OutlookFetchedMessage[] }> {
  const select = '$select=id,conversationId,subject,bodyPreview,receivedDateTime,from,toRecipients,body,hasAttachments';
  if (params.messageId) {
    const message = await graphFetch(params.accessToken, `/messages/${encodeURIComponent(params.messageId)}?${select}`);
    const mapped = mapMessage(message as GraphMessage);
    if ((message as GraphMessage).hasAttachments && mapped.id) {
      mapped._attachmentMetas = await outlookAttachments(params.accessToken, mapped.id);
    }
    return { messages: [mapped] };
  }
  // Graph search syntax differs from Gmail. Pass a free-text search, but avoid treating Gmail operators as a Graph filter.
  const query = new URLSearchParams({ '$top': String(params.maxResults), '$orderby': 'receivedDateTime desc', '$select': select.slice(8) });
  if (params.query && params.query !== 'is:unread') query.set('$search', `"${params.query.replace(/"/g, '')}"`);
  const result = await graphFetch(params.accessToken, `/messages?${query}`, {
    headers: params.query && params.query !== 'is:unread' ? { ConsistencyLevel: 'eventual' } : undefined,
  });
  const rows = Array.isArray(result.value) ? result.value as GraphMessage[] : [];
  const messages = await Promise.all(rows.map(async (row) => {
    const mapped = mapMessage(row);
    if (row.hasAttachments && mapped.id) {
      mapped._attachmentMetas = await outlookAttachments(params.accessToken, mapped.id);
    }
    return mapped;
  }));
  return { messages };
}

export async function outlookDownloadAttachment(params: {
  accessToken: string; messageId: string; attachmentId: string;
}): Promise<Buffer> {
  const result = await graphFetch(
    params.accessToken,
    `/messages/${encodeURIComponent(params.messageId)}/attachments/${encodeURIComponent(params.attachmentId)}`,
  );
  const contentBytes = typeof result.contentBytes === 'string' ? result.contentBytes : '';
  if (!contentBytes) throw new OutlookApiError('Microsoft Graph attachment response missing contentBytes');
  return Buffer.from(contentBytes, 'base64');
}

export async function outlookSend(params: {
  accessToken: string; to: string[]; subject: string; bodyText: string; replyToMessageId?: string | null;
}): Promise<EmailSendResult> {
  if (params.replyToMessageId) {
    await graphFetch(params.accessToken, `/messages/${encodeURIComponent(params.replyToMessageId)}/reply`, {
      method: 'POST', body: JSON.stringify({ comment: params.bodyText }),
    });
  } else {
    await graphFetch(params.accessToken, '/sendMail', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          subject: params.subject,
          body: { contentType: 'Text', content: params.bodyText },
          toRecipients: params.to.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: true,
      }),
    });
  }
  return { messageId: '', threadId: '', status: 'sent' };
}

export async function outlookCreateDraft(params: {
  accessToken: string; to: string[]; subject: string; bodyText: string;
}): Promise<EmailSendResult> {
  const result = await graphFetch(params.accessToken, '/messages', {
    method: 'POST',
    body: JSON.stringify({
      subject: params.subject,
      body: { contentType: 'Text', content: params.bodyText },
      toRecipients: params.to.map((address) => ({ emailAddress: { address } })),
      isDraft: true,
    }),
  });
  return { messageId: String(result.id ?? ''), threadId: String(result.conversationId ?? ''), draftId: String(result.id ?? ''), status: 'draft', mode: 'draft' };
}

export async function outlookListDrafts(params: { accessToken: string; maxResults?: number }): Promise<{
  drafts: NonNullable<EmailSendResult['drafts']>;
}> {
  const query = new URLSearchParams({ '$filter': 'isDraft eq true', '$top': String(Math.min(25, Math.max(1, params.maxResults ?? 10))), '$orderby': 'lastModifiedDateTime desc', '$select': 'id,conversationId,subject,bodyPreview,toRecipients' });
  const result = await graphFetch(params.accessToken, `/messages?${query}`);
  const rows = Array.isArray(result.value) ? result.value as GraphMessage[] : [];
  return { drafts: rows.map((message) => ({
    draftId: message.id ?? '', messageId: message.id ?? '', threadId: message.conversationId ?? '',
    to: (message.toRecipients ?? []).map((recipient) => recipient.emailAddress?.address ?? '').filter(Boolean),
    subject: message.subject ?? '', snippet: message.bodyPreview ?? '',
  })) };
}

export async function outlookDeleteDraft(params: { accessToken: string; draftId: string }): Promise<{ draftId: string; status: 'deleted' }> {
  await graphFetch(params.accessToken, `/messages/${encodeURIComponent(params.draftId)}`, { method: 'DELETE' });
  return { draftId: params.draftId, status: 'deleted' };
}
