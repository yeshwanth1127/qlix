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

export async function gmailSend(params: GmailSendParams): Promise<GmailSendResult> {
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

  const sendBody: Record<string, unknown> = { raw: base64UrlEncode(Buffer.from(mime, 'utf8')) };
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
  body?: { data?: string };
  parts?: GmailPart[];
}

/** Depth-first search for the first text/plain part; falls back to stripped text/html. */
function extractPlainText(payload: GmailPart | undefined): string {
  if (!payload) return '';
  const stack: GmailPart[] = [payload];
  let htmlFallback = '';
  while (stack.length > 0) {
    const part = stack.shift()!;
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

function headerValue(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

async function fetchMessage(accessToken: string, id: string): Promise<EmailReadResult['messages'][number]> {
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
  };
}

export async function gmailList(params: GmailListParams): Promise<EmailReadResult> {
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
