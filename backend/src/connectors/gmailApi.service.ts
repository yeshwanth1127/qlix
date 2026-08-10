/**
 * In-house Gmail REST client. Pure functions: an OAuth access token goes in, a
 * typed result comes out — no DB, no scope/JIT/audit logic (that lives in
 * emailTool.service). This replaces the previous per-org n8n webhook hop so the
 * Qlix server talks to Gmail directly.
 *
 * Token acquisition + refresh is handled by the caller (getFreshAccessToken).
 */
import type { EmailReadResult } from './connectors.types.js';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailApiError extends Error {
  readonly code = 'gmail_api_failed';
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

// ── encoding helpers ────────────────────────────────────────────────────────

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(data: string): Buffer {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

/** RFC 2047 encoded-word for header values that contain non-ASCII (e.g. a Subject with emoji). */
function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Wrap a long base64 string at 76 chars per line (RFC 2045). */
function wrap76(input: string): string {
  return input.match(/.{1,76}/g)?.join('\r\n') ?? input;
}

// ── shared fetch ────────────────────────────────────────────────────────────

async function gmailFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await resp.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  if (!resp.ok) {
    const apiMsg =
      (body.error as { message?: string } | undefined)?.message ?? text.slice(0, 300);
    throw new GmailApiError(`Gmail API ${resp.status}: ${apiMsg}`, resp.status);
  }
  return body;
}

// ── send ────────────────────────────────────────────────────────────────────

export interface GmailSendParams {
  accessToken: string;
  to: string[];
  subject: string;
  bodyText: string;
  /** Gmail message id of the message being replied to (sets threading headers + threadId). */
  replyToMessageId?: string | null;
}

export interface GmailSendResult {
  messageId: string;
  threadId: string;
  status: string;
}

function buildMimeMessage(params: {
  to: string[];
  subject: string;
  bodyText: string;
  inReplyTo?: string | null;
  references?: string | null;
}): string {
  const headers: string[] = [
    `To: ${params.to.join(', ')}`,
    `Subject: ${encodeHeaderValue(params.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  if (params.inReplyTo) headers.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) headers.push(`References: ${params.references}`);

  const body = wrap76(Buffer.from(params.bodyText, 'utf8').toString('base64'));
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

/** Look up the original message's RFC822 Message-ID + thread so a reply threads correctly. */
async function loadReplyContext(
  accessToken: string,
  replyToMessageId: string,
): Promise<{ threadId: string | null; inReplyTo: string | null; references: string | null }> {
  try {
    const meta = await gmailFetch(
      accessToken,
      `/messages/${encodeURIComponent(replyToMessageId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`,
    );
    const threadId = typeof meta.threadId === 'string' ? meta.threadId : null;
    const headers = ((meta.payload as { headers?: Array<{ name: string; value: string }> })?.headers) ?? [];
    const msgId = headers.find((h) => h.name.toLowerCase() === 'message-id')?.value ?? null;
    const refs = headers.find((h) => h.name.toLowerCase() === 'references')?.value ?? null;
    const references = [refs, msgId].filter(Boolean).join(' ') || null;
    return { threadId, inReplyTo: msgId, references };
  } catch {
    return { threadId: null, inReplyTo: null, references: null };
  }
}

async function buildRawMessage(params: GmailSendParams): Promise<{
  raw: string;
  threadId: string | null;
}> {
  let inReplyTo: string | null = null;
  let references: string | null = null;
  let threadId: string | null = null;

  if (params.replyToMessageId) {
    const ctx = await loadReplyContext(params.accessToken, params.replyToMessageId);
    inReplyTo = ctx.inReplyTo;
    references = ctx.references;
    threadId = ctx.threadId;
  }

  const mime = buildMimeMessage({
    to: params.to,
    subject: params.subject,
    bodyText: params.bodyText,
    inReplyTo,
    references,
  });

  return { raw: base64UrlEncode(Buffer.from(mime, 'utf8')), threadId };
}

export async function gmailSend(params: GmailSendParams): Promise<GmailSendResult> {
  const { raw, threadId } = await buildRawMessage(params);

  const sendBody: Record<string, unknown> = { raw };
  if (threadId) sendBody.threadId = threadId;

  const result = await gmailFetch(params.accessToken, '/messages/send', {
    method: 'POST',
    body: JSON.stringify(sendBody),
  });

  return {
    messageId: typeof result.id === 'string' ? result.id : '',
    threadId: typeof result.threadId === 'string' ? result.threadId : '',
    status: 'sent',
  };
}

export interface GmailDraftResult {
  draftId: string;
  messageId: string;
  threadId: string;
  status: 'draft';
}

/** Create a Gmail draft (requires gmail.compose). Does not send. */
export async function gmailCreateDraft(params: GmailSendParams): Promise<GmailDraftResult> {
  const { raw, threadId } = await buildRawMessage(params);

  const message: Record<string, unknown> = { raw };
  if (threadId) message.threadId = threadId;

  const result = await gmailFetch(params.accessToken, '/drafts', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });

  const messageObj = (result.message as { id?: string; threadId?: string } | undefined) ?? {};
  return {
    draftId: typeof result.id === 'string' ? result.id : '',
    messageId: typeof messageObj.id === 'string' ? messageObj.id : '',
    threadId: typeof messageObj.threadId === 'string' ? messageObj.threadId : threadId ?? '',
    status: 'draft',
  };
}

export interface GmailDraftListItem {
  draftId: string;
  messageId: string;
  threadId: string;
  to: string[];
  subject: string;
  snippet: string;
}

/** List Gmail drafts (requires gmail.compose). */
export async function gmailListDrafts(params: {
  accessToken: string;
  maxResults?: number;
}): Promise<{ drafts: GmailDraftListItem[] }> {
  const maxResults = Math.min(25, Math.max(1, params.maxResults ?? 10));
  const list = await gmailFetch(
    params.accessToken,
    `/drafts?maxResults=${maxResults}`,
  );
  const ids = Array.isArray(list.drafts)
    ? (list.drafts as Array<{ id?: string }>).map((d) => d.id).filter((x): x is string => Boolean(x))
    : [];

  const drafts: GmailDraftListItem[] = [];
  for (const draftId of ids) {
    const draft = await gmailFetch(params.accessToken, `/drafts/${encodeURIComponent(draftId)}`);
    const message = (draft.message as {
      id?: string;
      threadId?: string;
      snippet?: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    }) ?? {};
    const headers = message.payload?.headers ?? [];
    const toRaw = headers.find((h) => h.name.toLowerCase() === 'to')?.value ?? '';
    drafts.push({
      draftId: typeof draft.id === 'string' ? draft.id : draftId,
      messageId: typeof message.id === 'string' ? message.id : '',
      threadId: typeof message.threadId === 'string' ? message.threadId : '',
      to: toRaw ? toRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
      subject: headers.find((h) => h.name.toLowerCase() === 'subject')?.value ?? '',
      snippet: typeof message.snippet === 'string' ? message.snippet : '',
    });
  }
  return { drafts };
}

/** Delete a Gmail draft by draft id (requires gmail.compose). */
export async function gmailDeleteDraft(params: {
  accessToken: string;
  draftId: string;
}): Promise<{ draftId: string; status: 'deleted' }> {
  const draftId = params.draftId.trim();
  if (!draftId) throw new GmailApiError('draftId is required', 400);
  await gmailFetch(params.accessToken, `/drafts/${encodeURIComponent(draftId)}`, {
    method: 'DELETE',
  });
  return { draftId, status: 'deleted' };
}

// ── read ────────────────────────────────────────────────────────────────────

export interface GmailListParams {
  accessToken: string;
  query: string;
  maxResults: number;
  /** When set, fetch only this single message instead of running a search. */
  messageId?: string | null;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailAttachmentMeta {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/** Depth-first search for the first text/plain part; falls back to stripped text/html. */
function extractPlainText(payload: GmailPart | undefined): string {
  if (!payload) return '';
  const stack: GmailPart[] = [payload];
  let htmlFallback = '';
  while (stack.length > 0) {
    const part = stack.shift()!;
    // Skip named attachments — their payload is not the email body.
    if (part.filename) {
      if (part.parts) stack.push(...part.parts);
      continue;
    }
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return base64UrlDecode(part.body.data).toString('utf8');
    }
    if (part.mimeType === 'text/html' && part.body?.data && !htmlFallback) {
      htmlFallback = base64UrlDecode(part.body.data)
        .toString('utf8')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (part.parts) stack.push(...part.parts);
  }
  return htmlFallback;
}

/** Collect file parts that have a Gmail attachmentId (downloadable binaries). */
export function collectGmailAttachments(payload: GmailPart | undefined): GmailAttachmentMeta[] {
  if (!payload) return [];
  const out: GmailAttachmentMeta[] = [];
  const seen = new Set<string>();
  const stack: GmailPart[] = [payload];
  while (stack.length > 0) {
    const part = stack.shift()!;
    const attachmentId = part.body?.attachmentId?.trim();
    const fileName = (part.filename || '').trim();
    if (attachmentId && fileName && !seen.has(attachmentId)) {
      seen.add(attachmentId);
      out.push({
        attachmentId,
        fileName: fileName.slice(0, 255),
        mimeType: (part.mimeType || 'application/octet-stream').slice(0, 200),
        sizeBytes: typeof part.body?.size === 'number' ? part.body.size : 0,
      });
    }
    if (part.parts) stack.push(...part.parts);
  }
  return out;
}

export async function gmailDownloadAttachment(params: {
  accessToken: string;
  messageId: string;
  attachmentId: string;
}): Promise<Buffer> {
  const result = await gmailFetch(
    params.accessToken,
    `/messages/${encodeURIComponent(params.messageId)}/attachments/${encodeURIComponent(params.attachmentId)}`,
  );
  const data = typeof result.data === 'string' ? result.data : '';
  if (!data) throw new GmailApiError('Gmail attachment response missing data');
  return base64UrlDecode(data);
}

function headerValue(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export type GmailFetchedMessage = EmailReadResult['messages'][number] & {
  /** Raw attachment metadata before sandbox upload (filled by emailTool). */
  _attachmentMetas?: GmailAttachmentMeta[];
};

async function fetchMessage(accessToken: string, id: string): Promise<GmailFetchedMessage> {
  const msg = await gmailFetch(accessToken, `/messages/${encodeURIComponent(id)}?format=full`);
  const payload = msg.payload as (GmailPart & { headers?: Array<{ name: string; value: string }> }) | undefined;
  const headers = payload?.headers ?? [];
  const internalDate = typeof msg.internalDate === 'string' ? Number(msg.internalDate) : NaN;
  const toRaw = headerValue(headers, 'to');

  return {
    id: typeof msg.id === 'string' ? msg.id : id,
    threadId: typeof msg.threadId === 'string' ? msg.threadId : '',
    from: headerValue(headers, 'from'),
    to: toRaw ? toRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
    subject: headerValue(headers, 'subject'),
    snippet: typeof msg.snippet === 'string' ? msg.snippet : '',
    bodyText: extractPlainText(payload),
    receivedAt: Number.isFinite(internalDate)
      ? new Date(internalDate).toISOString()
      : new Date().toISOString(),
    _attachmentMetas: collectGmailAttachments(payload),
  };
}

export async function gmailList(params: GmailListParams): Promise<{ messages: GmailFetchedMessage[] }> {
  if (params.messageId) {
    return { messages: [await fetchMessage(params.accessToken, params.messageId)] };
  }

  const search = new URLSearchParams({
    q: params.query,
    maxResults: String(params.maxResults),
  });
  const list = await gmailFetch(params.accessToken, `/messages?${search.toString()}`);
  const ids = Array.isArray(list.messages)
    ? (list.messages as Array<{ id?: string }>).map((m) => m.id).filter((x): x is string => Boolean(x))
    : [];

  const messages = await Promise.all(ids.map((id) => fetchMessage(params.accessToken, id)));
  return { messages };
}
